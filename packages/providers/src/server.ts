import 'node:process';
import { z } from 'zod';
import { ProviderError, systemClock, type Clock, type NewsProvider, type NewsRequest, type NewsPage, type QuoteProvider, type QuoteBatch, type Security, type Provenance, type ProviderCapabilities } from './index.js';

const timestamp = z.string().datetime({ offset: true });
const newsShape = z.object({ news: z.array(z.object({ id: z.number().int().safe(), headline: z.string().min(1), summary: z.string().default(''), author: z.string().optional(), source: z.string(), url: z.string().url().nullable().optional(), created_at: timestamp, updated_at: timestamp, symbols: z.array(z.string()) })), next_page_token: z.string().nullable() });
const tradesShape = z.object({ trades: z.record(z.string(), z.object({ t: timestamp, p: z.string().regex(/^\d+(\.\d+)?$/), i: z.number().int().safe() })) });
const tokenShape = z.object({ source: z.literal('alpaca-v1'), start: timestamp, end: timestamp.optional(), page: z.string().optional() }).strict();
export interface AlpacaOptions { key: string; secret: string; rightsConfirmed: boolean; timeoutMs?: number; clock?: Clock; fetch?: typeof fetch }

/** Application-owned price snapshot = last IEX trade, not NBBO or consolidated SIP. */
export class AlpacaProviders implements QuoteProvider, NewsProvider {
  readonly sourceId = 'alpaca-iex-benzinga'; readonly mode = 'live' as const;
  readonly capabilities: ProviderCapabilities = { delivery: 'polling', timeliness: 'delayed', delayMs: 900000, pagination: true, checkpoints: true, corrections: true };
  private readonly clock: Clock; private readonly transport: typeof fetch; private readonly timeout: number;
  constructor(private readonly options: AlpacaOptions) {
    if (!options.key || !options.secret || !options.rightsConfirmed) throw new ProviderError('not_configured');
    this.clock = options.clock ?? systemClock; this.transport = options.fetch ?? fetch; this.timeout = options.timeoutMs ?? 10000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 30000) throw new Error('Invalid timeout');
  }
  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path, 'https://data.alpaca.markets');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await this.transport(url, { headers: { 'APCA-API-KEY-ID': this.options.key, 'APCA-API-SECRET-KEY': this.options.secret }, signal: controller.signal, redirect: 'error' });
      const retry = response.headers.get('retry-after'); const reset = response.headers.get('x-ratelimit-reset');
      const now = this.clock.now().getTime();
      const times = [retry ? (/^\d+(\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)) : NaN, reset ? Number(reset) * 1000 : NaN].filter(t => Number.isFinite(t) && t > now);
      const retryAt = times.length ? new Date(Math.max(...times)).toISOString() : null;
      if (response.status === 429) throw new ProviderError('rate_limit', retryAt);
      if (response.status === 401 || response.status === 403) throw new ProviderError('not_configured');
      if (!response.ok) throw new ProviderError('outage', retryAt);
      // Preserve the decimal price lexeme before JSON converts it to a binary float.
      const body = await response.text();
      if (body.length > 2000000) throw new ProviderError('outage');
      return JSON.parse(body.replace(/("p"\s*:\s*)(\d+(?:\.\d+)?)(?=\s*[,}])/g, '$1"$2"')) as unknown;
    } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('outage'); }
    finally { clearTimeout(timer); }
  }
  private meta(id: string, at: string, now: string): Provenance {
    return { sourceId: this.sourceId, sourceRecordId: id, providerAt: new Date(at).toISOString(), ingestedAt: now, isDelayed: this.capabilities.timeliness === 'delayed', delayMs: this.capabilities.delayMs, isSynthetic: false };
  }
  async getQuotes(securities: readonly Security[]): Promise<QuoteBatch> {
    const now = this.clock.now().toISOString(); const quotes: QuoteBatch['quotes'] = []; const missing: Security[] = [];
    const symbols = new Map<string, Security>();
    for (const security of securities) {
      const symbol = security.symbol.trim().toUpperCase(), mic = security.exchangeMic.trim().toUpperCase();
      if (!['XNAS', 'XNYS', 'XASE', 'ARCX', 'BATS'].includes(mic) || securities.filter(s => s.symbol.trim().toUpperCase() === symbol).length !== 1) missing.push(security);
      else symbols.set(symbol, { symbol, exchangeMic: mic });
    }
    const entries = [...symbols.entries()];
    for (let offset = 0; offset < entries.length; offset += 100) {
      const chunk = entries.slice(offset, offset + 100);
      const parsed = tradesShape.safeParse(await this.request('/v2/stocks/trades/latest', { symbols: chunk.map(([symbol]) => symbol).join(','), feed: 'iex' }));
      if (!parsed.success) throw new ProviderError('outage');
      for (const [symbol, security] of chunk) {
        const trade = parsed.data.trades[symbol];
        if (!trade || !/[1-9]/.test(trade.p) || Date.parse(trade.t) > Date.parse(now)) missing.push(security);
        else quotes.push({ ...this.meta(`${symbol}:${trade.i}`, trade.t, now), security, currency: 'USD', price: trade.p });
      }
    }
    return { quotes, missing, checkpoint: now, fetchedAt: now };
  }
  async getNews(request: NewsRequest = {}): Promise<NewsPage> {
    if (request.cursor && request.checkpoint) throw new ProviderError('invalid_checkpoint');
    let state: z.infer<typeof tokenShape>;
    const now = this.clock.now(); const end = new Date(now.getTime() - 900000).toISOString();
    try {
      state = request.cursor || request.checkpoint ? tokenShape.parse(JSON.parse(request.cursor ?? request.checkpoint!)) : { source: 'alpaca-v1', start: new Date(now.getTime() - 86400000).toISOString() };
      if (state.page && !state.end) throw new Error('Missing window');
      if (Date.parse(state.start) > Date.parse(state.end ?? end)) throw new Error('Invalid window');
    } catch { throw new ProviderError('invalid_checkpoint'); }
    const limit = request.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid limit');
    const windowEnd = state.end ?? end;
    const parsed = newsShape.safeParse(await this.request('/v1beta1/news', { start: state.start, end: windowEnd, sort: 'asc', include_content: 'false', limit: String(Math.min(limit, 50)), ...(state.page ? { page_token: state.page } : {}) }));
    if (!parsed.success) throw new ProviderError('outage');
    // The documented URL is optional/null. Do not invent a link or block the rest of the page.
    const articles = parsed.data.news.flatMap(item => item.url ? [{ ...this.meta(String(item.id), item.updated_at, now.toISOString()), canonicalUrl: item.url, publishedAt: new Date(item.created_at).toISOString(), revision: Date.parse(item.updated_at), title: item.headline, summary: item.summary, category: 'NEWS', symbols: [...new Set(item.symbols.map(s => s.trim().toUpperCase()))], publisher: item.source, author: item.author ?? null }] : []);
    const nextCursor = parsed.data.next_page_token ? JSON.stringify({ ...state, end: windowEnd, page: parsed.data.next_page_token }) : null;
    // Inclusive overlap replays recent changes; updates outside this window need a backfill.
    const checkpoint = nextCursor ?? JSON.stringify({ source: 'alpaca-v1', start: new Date(Date.parse(windowEnd) - 3600000).toISOString() });
    return { articles, nextCursor, checkpoint, fetchedAt: now.toISOString() };
  }
}
export class AlpacaQuoteProvider extends AlpacaProviders {
  override readonly capabilities: ProviderCapabilities = { delivery: 'polling', timeliness: 'real-time', delayMs: 0, pagination: false, checkpoints: false, corrections: false };
}
export class AlpacaNewsProvider extends AlpacaProviders {}
