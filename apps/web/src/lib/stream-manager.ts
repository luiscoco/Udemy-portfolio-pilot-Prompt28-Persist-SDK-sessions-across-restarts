import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { browserEventSchema, eventRecoverySchema, type BrowserEvent, type PortfolioSummary } from '@portfolio-pilot/contracts';
import { apiRequest } from './api-client';
import { AgentRunStore, isAgentEvent } from './agent-runs';

export type ConnectionState = 'Live' | 'Reconnecting' | 'Offline';
export type NewsNotice = { sequence: number; articleId: string; portfolioIds: string[]; watchlisted: boolean };
type State = { connection: ConnectionState; ready: boolean; newsNotices: NewsNotice[] };
const eventTypes = ['research.updated', 'portfolio.updated', 'watchlist.updated', 'news.available', 'quote.updated', 'agent.run.started', 'agent.text.delta', 'agent.block.completed', 'agent.tool.status', 'agent.message.completed', 'agent.run.completed', 'stream.reset'];
// Chat reads are refetched after a snapshot too: events missed before it are recovered from PostgreSQL.
const recoveredKeys = new Set(['portfolios', 'watchlist', 'news', 'news-detail', 'news-impact', 'recommendations', 'alert-rules', 'alert-notifications', 'summary', 'transactions', 'quotes', 'market', 'chat-messages', 'chat-run']);

// Events are notifications, not records. Refetch authoritative targeted reads instead of
// applying partial/stale records over a newer snapshot. Query cancellation fences old reads.
export function invalidateEvent(cache: QueryClient, event: BrowserEvent, current = () => true) {
  const refresh = async (filters: Parameters<QueryClient['invalidateQueries']>[0]) => {
    // Explicitly cancel even a first fetch without data: cancelRefetch alone coalesces
    // that fetch, which could otherwise return a pre-event value and lose the update.
    await cache.cancelQueries(filters);
    if (current()) await cache.invalidateQueries(filters);
  };
  const invalidate = (queryKey: QueryKey) => void refresh({ queryKey });
  switch (event.type) {
    case 'research.updated': invalidate(['recommendations']); invalidate(['news-impact']); invalidate(['alert-rules']); invalidate(['alert-notifications']); break;
    case 'portfolio.updated':
      invalidate(['news-impact']); invalidate(['recommendations']);
      invalidate(['news-detail']);
      invalidate(['portfolios']); invalidate(['summary', event.portfolioId]);
      if (event.change === 'transaction.recorded') invalidate(['transactions', event.portfolioId]);
      if (event.change === 'transaction.recorded' || event.change === 'archived') invalidate(['news']);
      break;
    case 'watchlist.updated': invalidate(['watchlist']); invalidate(['news']); invalidate(['news-detail']); invalidate(['news-impact']); invalidate(['recommendations']); break;
    case 'news.available':
      // A correction can invalidate recommendations on other articles that cited this one.
      invalidate(['news-impact']); invalidate(['recommendations']);
      invalidate(['news-detail', event.articleId]);
      invalidate(['news', null]);
      for (const id of event.portfolioIds) invalidate(['news', id]);
      invalidate(['market']); break;
    case 'quote.updated': {
      invalidate(['news-detail']);
      const ids = new Set(event.quotes.map(q => q.securityId));
      void refresh({ predicate: query => {
        if (query.queryKey[0] === 'quotes') return query.queryKey.slice(1).flat().some(id => ids.has(String(id)));
        if (query.queryKey[0] !== 'summary') return false;
        const data = query.state.data as { summary: PortfolioSummary } | undefined;
        return !data || data.summary.positions.some(h => ids.has(h.securityId));
      } });
      invalidate(['market']); break;
    }
    // Draft text lives in the run store; only durable outcomes refresh persisted chat reads.
    case 'agent.message.completed': invalidate(['chat-messages', event.conversationId]); break;
    case 'agent.run.completed': invalidate(['chat-run', event.conversationId]); break;
  }
}

/** One manager per authenticated provider, shared by every consumer in that app. */
export class StreamManager {
  private state: State = { connection: 'Reconnecting', ready: false, newsNotices: [] };
  private newsSequence = 0;
  private listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cursor: string | null = null;
  private seen = new Set<string>();
  private running = false;
  private generation = 0;
  private scopeGeneration = 0;
  private failures = 0;
  private recovering = false;
  private replayFloor: string | null = null;
  /** Incremented whenever a snapshot replaces the cursor; see ensureReplay. */
  recoveries = 0;
  readonly agentRuns = new AgentRunStore();
  constructor(readonly userId: string, private cache: QueryClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.running) {
      this.running = true;
      window.addEventListener('offline', this.offline);
      window.addEventListener('online', this.online);
      void this.recover();
    }
    return () => {
      this.listeners.delete(listener);
      // StrictMode's immediate unsubscribe/subscribe retains the same connection.
      queueMicrotask(() => { if (!this.listeners.size) this.stop(); });
    };
  };
  private update(connection: ConnectionState, ready = this.state.ready) {
    this.state = { ...this.state, connection, ready }; this.listeners.forEach(listener => listener());
  }
  private close() { this.source?.close(); this.source = null; clearTimeout(this.timer); }
  stop() {
    this.running = false; this.generation++; this.scopeGeneration++; this.close(); this.controller?.abort();
    this.cursor = null; this.seen.clear(); this.failures = 0; this.replayFloor = null; this.agentRuns.clear();
    this.newsSequence = 0; this.state = { ...this.state, newsNotices: [] };
    window.removeEventListener('offline', this.offline); window.removeEventListener('online', this.online);
    this.update('Offline', false);
  }
  private offline = () => { this.generation++; this.close(); this.controller?.abort(); this.update('Offline'); };
  private online = () => { if (this.running) { this.failures = 0; this.cursor ? this.connect() : void this.recover(); } };
  private retry(snapshot: boolean) {
    this.close();
    if (!this.running) return;
    this.failures++;
    this.update(!navigator.onLine || this.failures >= 3 ? 'Offline' : 'Reconnecting');
    if (navigator.onLine) this.timer = setTimeout(() => snapshot ? void this.recover() : this.connect(), Math.min(1000 * 2 ** (this.failures - 1), 15000));
  }
  /**
   * Race-free run handshake. `cursor` was captured by the server before the run existed. The
   * connection's own cursor predates the POST unless a snapshot recovery replaced it meanwhile (or
   * there is none yet); in those cases replay from the pre-run cursor. Replaying older entries is
   * safe: domain UUIDs dedupe, invalidations are idempotent and agent events dedupe by sequence.
   */
  ensureReplay(recoveriesBefore: number, cursor: string | null) {
    if (!cursor || !this.running) return;
    if (this.recovering) { this.replayFloor = cursor; return; }
    if (this.cursor && this.recoveries === recoveriesBefore) return;
    this.cursor = cursor; this.failures = 0; this.connect();
  }
  private async recover() {
    this.close(); this.controller?.abort(); this.cursor = null;
    // Until a snapshot installs a cursor (even across an offline period), replay floors are deferred to it.
    this.recovering = true;
    const generation = ++this.generation;
    this.controller = new AbortController();
    if (!navigator.onLine) { this.update('Offline'); return; }
    this.update('Reconnecting');
    try {
      const snapshot = await apiRequest('/api/events/recovery', eventRecoverySchema, { signal: this.controller.signal });
      if (!this.running || generation !== this.generation) return;
      const predicate = (query: { queryKey: QueryKey }) => recoveredKeys.has(String(query.queryKey[0]));
      await this.cache.cancelQueries({ predicate });
      if (!this.running || generation !== this.generation) return;
      this.cache.setQueryData(['portfolios'], { portfolios: snapshot.portfolios });
      this.cache.setQueryData(['watchlist'], { entries: snapshot.watchlist });
      this.cache.setQueryData(['news', null], snapshot.news);
      // Derived snapshots are fetched after the captured cursor; replay invalidates them again.
      await this.cache.invalidateQueries({ predicate: q => predicate(q) && !['portfolios', 'watchlist'].includes(String(q.queryKey[0])) && !(q.queryKey[0] === 'news' && q.queryKey[1] === null) });
      if (!this.running || generation !== this.generation) return;
      this.seen.clear(); this.recoveries++;
      // A run created while this snapshot was loading may have published before its cursor.
      this.cursor = snapshot.cursor ? this.replayFloor ?? snapshot.cursor : null; this.replayFloor = null;
      this.recovering = false;
      this.update('Reconnecting', true);
      if (this.cursor) this.connect(); else this.retry(true);
    } catch { if (this.running && generation === this.generation) this.retry(true); }
    finally { if (generation === this.generation) this.recovering = false; }
  }
  private connect() {
    this.close();
    if (!this.running || !this.cursor) return;
    if (!navigator.onLine) { this.update('Offline'); return; }
    this.update('Reconnecting');
    const source = new EventSource(`/api/events?cursor=${encodeURIComponent(this.cursor)}`);
    this.source = source;
    source.onopen = () => { if (this.source === source) { this.failures = 0; this.update('Live'); } };
    source.onerror = () => { if (this.source === source) this.retry(false); };
    for (const type of eventTypes) source.addEventListener(type, raw => {
      if (this.source !== source || !this.running) return;
      const message = raw as MessageEvent<string>;
      let event: BrowserEvent;
      try { event = browserEventSchema.parse(JSON.parse(message.data)); if (event.type !== type) throw new Error('Event type mismatch'); }
      catch { void this.recover(); return; }
      if (event.type === 'stream.reset') { this.cursor = null; this.retry(true); return; }
      if (!message.lastEventId || message.lastEventId.length > 2048) { void this.recover(); return; }
      // Transport cursor advances even when the domain UUID has already been applied.
      this.cursor = message.lastEventId;
      if (this.seen.has(event.id)) return;
      this.seen.add(event.id);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
      if (isAgentEvent(event)) this.agentRuns.apply(event);
      if (event.type === 'news.available') {
        this.state = { ...this.state, newsNotices: [...this.state.newsNotices, { sequence: ++this.newsSequence, articleId: event.articleId, portfolioIds: event.portfolioIds, watchlisted: event.watchlisted }].slice(-100) };
        this.listeners.forEach(listener => listener());
      }
      // A network transition must not discard a notification already received. Only
      // disposal of this authenticated scope fences its queued invalidations.
      const scope = this.scopeGeneration;
      invalidateEvent(this.cache, event, () => this.running && scope === this.scopeGeneration);
    });
  }
}

