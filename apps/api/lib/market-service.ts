import { marketSnapshotSchema, type MarketSnapshot } from '@portfolio-pilot/contracts';
import { ProviderError, systemClock, type Clock, type NewsProvider, type QuoteProvider, type ProviderMode } from '@portfolio-pilot/providers';

// Process-local public demo snapshot; durable ingestion/cache is milestone 12/13.
export class MarketService {
  private last: MarketSnapshot | undefined;
  private checkpoint: string | undefined;
  private pending: Promise<MarketSnapshot> | undefined;
  constructor(private readonly mode: ProviderMode, private readonly providers: { quotes: QuoteProvider; news: NewsProvider } | undefined, private readonly intervalMs: number, private readonly clock: Clock = systemClock) {}
  snapshot(): Promise<MarketSnapshot> {
    if (this.pending) return this.pending;
    this.pending = this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async read(): Promise<MarketSnapshot> {
    const asOf = this.clock.now().toISOString();
    const base: MarketSnapshot = { mode: this.mode, status: 'unavailable', asOf, fetchedAt: null, staleAfterMs: 60000, intervalMs: this.intervalMs, error: null, retryAt: null, providers: [], quotes: [], missing: [], articles: [] };
    try {
      if (!this.providers) throw new ProviderError('not_configured');
      const { quotes, news } = this.providers;
      if (quotes.mode !== this.mode || news.mode !== this.mode) throw new ProviderError('not_configured');
      const [batch, page] = await Promise.all([quotes.getQuotes([{ symbol: 'ACME', exchangeMic: 'XNAS' }, { symbol: 'NOVA', exchangeMic: 'XNAS' }]), news.getNews({ limit: 100, ...(this.checkpoint && news.capabilities.checkpoints ? { checkpoint: this.checkpoint } : {}) })]);
      const articles = new Map((this.last?.articles ?? []).map(article => [`${article.sourceId}:${article.sourceRecordId}`, article]));
      for (const article of page.articles) {
        const key = `${article.sourceId}:${article.sourceRecordId}`;
        if ((articles.get(key)?.revision ?? 0) <= article.revision) articles.set(key, article);
      }
      const stale = batch.quotes.some(quote => Date.parse(asOf) - Date.parse(quote.providerAt) > base.staleAfterMs || Date.parse(quote.providerAt) > Date.parse(asOf));
      const result = marketSnapshotSchema.parse({ ...base, status: stale ? 'stale' : 'fresh', fetchedAt: batch.fetchedAt,
        quotes: batch.quotes, missing: batch.missing, articles: [...articles.values()].sort((a, b) => b.providerAt.localeCompare(a.providerAt)).slice(0, 20),
        providers: [quotes, news].map((provider, i) => ({ sourceId: provider.sourceId, kind: i === 0 ? 'quotes' : 'news', delivery: provider.capabilities.delivery, timeliness: provider.capabilities.timeliness, delayMs: provider.capabilities.delayMs })) });
      this.checkpoint = page.checkpoint; this.last = result; return result;
    } catch (error) {
      const code = error instanceof ProviderError && error.code !== 'invalid_checkpoint' ? error.code : 'outage';
      // Never change value timestamps or mode on failure, even within the freshness window.
      return marketSnapshotSchema.parse({ ...(this.last ?? base), asOf, status: this.last ? 'stale' : 'unavailable', error: code, retryAt: error instanceof ProviderError ? error.retryAt : null });
    }
  }
}
