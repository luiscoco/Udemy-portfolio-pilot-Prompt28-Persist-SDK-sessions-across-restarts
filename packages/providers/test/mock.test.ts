import { describe, expect, it } from 'vitest';
import { ManualClock, MockProviders, selectProviders } from '../src/index.js';
import { providerContract } from './provider-contract.js';
const epoch = '2026-10-02T12:00:00.000Z';
const setup = (scenario: ConstructorParameters<typeof MockProviders>[0] = {}) => { const clock = new ManualClock(epoch); const mock = new MockProviders({ clock, intervalMs: 1000, ...scenario }); return { clock, mock }; };
providerContract('mock', () => { const { clock, mock } = setup(); clock.advance(2000); return { quotes: mock, news: mock, known: { symbol: 'ACME', exchangeMic: 'XNAS' }, unknown: { symbol: 'UNKNOWN', exchangeMic: 'XNAS' } }; });
describe('deterministic fixtures', () => {
  it('replays identically and releases news only on scheduled intervals', async () => {
    const a = setup(), b = setup(); expect((await a.mock.getNews()).articles).toEqual([]);
    a.clock.advance(999); expect((await a.mock.getNews()).articles).toEqual([]);
    a.clock.advance(1); b.clock.advance(1000); const first = await a.mock.getNews(); expect(first).toEqual(await b.mock.getNews());
    expect((await a.mock.getNews({ checkpoint: first.checkpoint })).articles).toEqual([]);
    a.clock.advance(1000); expect((await a.mock.getNews({ checkpoint: first.checkpoint })).articles[0]?.sourceRecordId).toBe('news-1');
  });
  it('preserves duplicate delivery, correction identity and contradictory reports', async () => {
    for (const scenario of ['duplicates', 'corrections', 'conflicts'] as const) {
      const { clock, mock } = setup({ scenario }); clock.advance(2000); const { articles } = await mock.getNews();
      if (scenario === 'duplicates') expect(articles[0]).toEqual(articles[1]);
      if (scenario === 'corrections') { expect(articles[0]?.canonicalUrl).toBe(articles[1]?.canonicalUrl); expect(articles[1]?.revision).toBe(2); expect(articles[1]?.providerAt).not.toBe(articles[0]?.providerAt); }
      if (scenario === 'conflicts') { expect(articles[1]?.title).toContain('declines'); expect(articles[0]?.title).toContain('steady'); }
    }
  });
  it('reports missing quotes without zero-price fabrication', async () => {
    const { mock } = setup({ scenario: 'missing_quotes' }); const batch = await mock.getQuotes([{ symbol: 'ACME', exchangeMic: 'XNAS' }]); expect(batch.quotes).toEqual([]); expect(batch.missing).toHaveLength(1);
  });
  it('raises typed rate limits and outages for both interfaces', async () => {
    for (const scenario of ['rate_limit', 'outage'] as const) { const { mock } = setup({ scenario }); await expect(mock.getNews()).rejects.toMatchObject({ code: scenario }); await expect(mock.getQuotes([])).rejects.toMatchObject({ code: scenario }); }
  });
  it('never selects mocks as a live fallback', () => { expect(() => selectProviders('live')).toThrow('not_configured'); const { mock } = setup(); expect(() => selectProviders('live', {}, { quotes: mock, news: mock })).toThrow(); });
  it('validates schedule, bounded pagination and checkpoint scope', async () => { const { clock, mock } = setup(); clock.advance(2000); await expect(mock.getNews({ limit: 101 })).rejects.toThrow(); const page = await mock.getNews(); const other = setup({ scenario: 'conflicts' }); other.clock.advance(2000); await expect(other.mock.getNews({ checkpoint: page.checkpoint })).rejects.toThrow(); expect(() => clock.advance(-1)).toThrow(); });
});
