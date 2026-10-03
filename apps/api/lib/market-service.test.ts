import { describe, expect, it } from 'vitest';
import { ManualClock, MockProviders, ProviderError, type QuoteProvider, type NewsProvider } from '@portfolio-pilot/providers';
import { MarketService } from './market-service';
describe('market snapshots without external credentials', () => {
  it('polls deterministically, deduplicates and applies corrections', async () => {
    const clock = new ManualClock('2026-10-02T12:00:00.000Z'); const mock = new MockProviders({ clock, scenario: 'corrections', intervalMs: 1000 }); const service = new MarketService('mock', { quotes: mock, news: mock }, 1000, clock);
    clock.advance(1000); const first = await service.snapshot(); expect(first.mode).toBe('mock'); expect(first.status).toBe('fresh'); expect(first.quotes[0]?.currency).toBe('USD');
    clock.advance(1000); const second = await service.snapshot(); expect(second.articles).toHaveLength(1); expect(second.articles[0]?.revision).toBe(2);
    expect((await service.snapshot()).articles).toEqual(second.articles);
  });
  it('keeps cached timestamps and marks stale immediately on failure, then recovers', async () => {
    const clock = new ManualClock('2026-10-02T12:00:00.000Z'); const mock = new MockProviders({ clock, intervalMs: 1000 }); const service = new MarketService('mock', { quotes: mock, news: mock }, 1000, clock);
    clock.advance(1000); const first = await service.snapshot(); mock.scenario = 'outage'; clock.advance(1000); const stale = await service.snapshot();
    expect(stale.status).toBe('stale'); expect(stale.quotes).toEqual(first.quotes); expect(stale.fetchedAt).toBe(first.fetchedAt); expect(stale.articles).toEqual(first.articles);
    mock.scenario = 'ordinary'; expect((await service.snapshot()).articles).toHaveLength(2);
  });
  it('shows empty unavailable live data and rejects cross-mode adapters', async () => {
    const service = new MarketService('live', undefined, 30000); expect(await service.snapshot()).toMatchObject({ mode: 'live', status: 'unavailable', error: 'not_configured', quotes: [], articles: [] });
    const mock = new MockProviders(); expect((await new MarketService('live', { quotes: mock, news: mock }, 30000).snapshot()).status).toBe('unavailable');
  });
  it('retains recorded live values as stale during rate limits without synthetic fallback', async () => {
    const clock = new ManualClock('2026-10-02T12:00:00.000Z'); let failed = false;
    const capabilities = { delivery: 'polling' as const, timeliness: 'delayed' as const, delayMs: 1000, pagination: false, checkpoints: true, corrections: false };
    const quote = { sourceId: 'recorded-live', sourceRecordId: 'acme', providerAt: '2026-10-02T11:59:59.000Z', ingestedAt: clock.now().toISOString(), isSynthetic: false, isDelayed: true, delayMs: 1000, security: { symbol: 'ACME', exchangeMic: 'XNAS' }, currency: 'USD', price: '123.45' };
    const quotes: QuoteProvider = { sourceId: 'recorded-live', mode: 'live', capabilities, async getQuotes() { if (failed) throw new ProviderError('rate_limit', '2026-10-02T12:01:00.000Z'); return { quotes: [quote], missing: [], checkpoint: 'recorded-1', fetchedAt: clock.now().toISOString() }; } };
    const news: NewsProvider = { sourceId: 'recorded-live', mode: 'live', capabilities, async getNews() { return { articles: [], nextCursor: null, checkpoint: 'recorded-1', fetchedAt: clock.now().toISOString() }; } };
    const service = new MarketService('live', { quotes, news }, 1000, clock); const first = await service.snapshot(); failed = true; clock.advance(1000); const stale = await service.snapshot();
    expect(stale).toMatchObject({ mode: 'live', status: 'stale', error: 'rate_limit', retryAt: '2026-10-02T12:01:00.000Z', fetchedAt: first.fetchedAt }); expect(stale.quotes).toEqual(first.quotes); expect(stale.quotes[0]?.isSynthetic).toBe(false);
  });
  it('coalesces duplicate deliveries and marks old quote evidence stale', async () => {
    const clock = new ManualClock('2026-10-02T12:00:00.000Z'); const mock = new MockProviders({ clock, scenario: 'duplicates', intervalMs: 1000 }); const service = new MarketService('mock', { quotes: mock, news: mock }, 1000, clock);
    clock.advance(1000); expect((await service.snapshot()).articles).toHaveLength(1);
    const batch = await mock.getQuotes([{ symbol: 'ACME', exchangeMic: 'XNAS' }]); clock.advance(60001);
    const oldQuotes = { ...mock, getQuotes: async () => batch };
    expect((await new MarketService('mock', { quotes: oldQuotes, news: mock }, 1000, clock).snapshot()).status).toBe('stale');
  });
});
