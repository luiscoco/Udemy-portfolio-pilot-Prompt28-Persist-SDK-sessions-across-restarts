export type ProviderMode = 'mock' | 'live';
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export class ManualClock implements Clock {
  private time: number;
  constructor(start: string) { this.time = Date.parse(start); if (!Number.isFinite(this.time)) throw new Error('Invalid clock'); }
  now() { return new Date(this.time); }
  advance(ms: number) { if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('Invalid advance'); this.time += ms; }
}
export interface ProviderCapabilities {
  delivery: 'polling' | 'push'; timeliness: 'delayed' | 'real-time'; delayMs: number;
  pagination: boolean; checkpoints: boolean; corrections: boolean;
}
export interface ProviderIdentity { sourceId: string; mode: ProviderMode; capabilities: ProviderCapabilities }
export interface Provenance {
  sourceId: string; sourceRecordId: string; providerAt: string; ingestedAt: string;
  isDelayed: boolean; delayMs: number; isSynthetic: boolean;
}
export interface Security { symbol: string; exchangeMic: string }
export interface Quote extends Provenance { security: Security; currency: string; price: string }
export interface Article extends Provenance {
  canonicalUrl: string; publishedAt: string; revision: number; title: string; summary: string;
  category: string; symbols: string[];
  publisher?: string; author?: string | null;
}
export interface QuoteBatch { quotes: Quote[]; missing: Security[]; checkpoint: string; fetchedAt: string }
export interface NewsPage { articles: Article[]; nextCursor: string | null; checkpoint: string; fetchedAt: string }
export interface NewsRequest { cursor?: string; checkpoint?: string; limit?: number }
export interface QuoteProvider extends ProviderIdentity { getQuotes(securities: readonly Security[]): Promise<QuoteBatch> }
export interface NewsProvider extends ProviderIdentity { getNews(request?: NewsRequest): Promise<NewsPage> }
export class ProviderError extends Error {
  constructor(public readonly code: 'rate_limit' | 'outage' | 'not_configured' | 'invalid_checkpoint', public readonly retryAt: string | null = null) { super(`Provider ${code}`); }
}
export type MockScenario = 'ordinary' | 'duplicates' | 'corrections' | 'conflicts' | 'missing_quotes' | 'rate_limit' | 'outage';
export interface MockOptions { clock?: Clock; startAt?: string; intervalMs?: number; scenario?: MockScenario }
const prices: Record<string, string> = { 'ACME:XNAS': '125.00', 'ACME:XNYS': '85.00', 'NOVA:XNAS': '72.50' };
export class MockProviders implements QuoteProvider, NewsProvider {
  readonly sourceId = 'portfolio-pilot-mock'; readonly mode = 'mock' as const;
  readonly capabilities: ProviderCapabilities = { delivery: 'polling', timeliness: 'delayed', delayMs: 1000, pagination: true, checkpoints: true, corrections: true };
  readonly clock: Clock; readonly start: number; readonly intervalMs: number; scenario: MockScenario;
  constructor(options: MockOptions = {}) {
    this.clock = options.clock ?? systemClock; this.start = Date.parse(options.startAt ?? this.clock.now().toISOString());
    this.intervalMs = options.intervalMs ?? 30000; this.scenario = options.scenario ?? 'ordinary';
    if (!Number.isFinite(this.start) || !Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1000) throw new Error('Invalid mock schedule');
  }
  private check() {
    if (this.scenario === 'outage') throw new ProviderError('outage');
    if (this.scenario === 'rate_limit') throw new ProviderError('rate_limit', new Date(this.clock.now().getTime() + this.intervalMs).toISOString());
  }
  private meta(id: string, at: number, now: string): Provenance {
    return { sourceId: this.sourceId, sourceRecordId: id, providerAt: new Date(at).toISOString(), ingestedAt: now, isDelayed: true, delayMs: 1000, isSynthetic: true };
  }
  async getQuotes(securities: readonly Security[]): Promise<QuoteBatch> {
    this.check(); const now = this.clock.now(); const quotes: Quote[] = []; const missing: Security[] = [];
    for (const security of securities) {
      const price = this.scenario === 'missing_quotes' ? undefined : prices[`${security.symbol}:${security.exchangeMic}`];
      if (price === undefined) missing.push({ ...security });
      else quotes.push({ ...this.meta(`${security.symbol}:${security.exchangeMic}`, now.getTime() - 1000, now.toISOString()), security: { ...security }, currency: 'USD', price });
    }
    return { quotes, missing, checkpoint: now.toISOString(), fetchedAt: now.toISOString() };
  }
  async getNews(request: NewsRequest = {}): Promise<NewsPage> {
    this.check(); const now = this.clock.now();
    const total = Math.max(0, Math.floor((now.getTime() - this.start - 1000) / this.intervalMs) + 1);
    const scope = `${this.start}:${this.intervalMs}:${this.scenario}`;
    const decode = (token: string | undefined) => {
      if (token === undefined) return 0;
      const prefix = `${scope}:`; const value = Number(token.slice(prefix.length));
      if (!token.startsWith(prefix) || !/^\d+$/.test(token.slice(prefix.length)) || !Number.isSafeInteger(value) || value > total) throw new ProviderError('invalid_checkpoint');
      return value;
    };
    if (request.cursor !== undefined && request.checkpoint !== undefined) throw new ProviderError('invalid_checkpoint');
    const offset = decode(request.cursor ?? request.checkpoint); const limit = request.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be 1–100');
    const end = Math.min(total, offset + limit); const articles: Article[] = [];
    for (let i = offset; i < end; i++) {
      const at = this.start + i * this.intervalMs;
      const correction = this.scenario === 'corrections' && i === 1;
      const conflict = this.scenario === 'conflicts' && i === 1;
      const article: Article = { ...this.meta(correction ? 'news-0' : `news-${i}`, at, now.toISOString()), canonicalUrl: `https://example.com/mock/news/${correction ? 0 : i}`, publishedAt: new Date(correction ? this.start : at).toISOString(), revision: correction ? 2 : 1, title: correction ? 'Correction: ACME reports flat demand' : conflict ? 'Conflicting report: ACME demand declines' : `ACME reports steady demand — update ${i + 1}`, summary: 'Fictional teaching fixture. Reports are evidence to compare, not investment advice.', category: correction ? 'CORRECTION' : 'MARKET UPDATE', symbols: ['ACME'] };
      articles.push(article);
      if (this.scenario === 'duplicates' && i === 0) articles.push({ ...article, symbols: [...article.symbols] });
    }
    return { articles, nextCursor: end < total ? `${scope}:${end}` : null, checkpoint: `${scope}:${end}`, fetchedAt: now.toISOString() };
  }
}
export class MockQuoteProvider extends MockProviders {
  override readonly capabilities: ProviderCapabilities = { delivery: 'polling', timeliness: 'delayed', delayMs: 1000, pagination: false, checkpoints: true, corrections: false };
}
export class MockNewsProvider extends MockProviders {}
export function selectProviders(mode: ProviderMode, options: MockOptions = {}, live?: { quotes: QuoteProvider; news: NewsProvider }): { quotes: QuoteProvider; news: NewsProvider } {
  if (mode === 'mock') {
    const clock = options.clock ?? systemClock;
    const shared = { ...options, clock, startAt: options.startAt ?? clock.now().toISOString() };
    return { quotes: new MockQuoteProvider(shared), news: new MockNewsProvider(shared) };
  }
  if (!live || live.quotes.mode !== 'live' || live.news.mode !== 'live') throw new ProviderError('not_configured');
  return live;
}
