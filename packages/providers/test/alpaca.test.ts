import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../src/index.js';
import { AlpacaNewsProvider, AlpacaQuoteProvider } from '../src/server.js';
import { news, article, trades } from './fixtures/alpaca.js';
import { providerContract } from './provider-contract.js';
const clock = new ManualClock('2026-10-02T12:00:00.000Z');
const options = { key: 'fixture-key', secret: 'fixture-secret', rightsConfirmed: true, clock };
providerContract('Alpaca recorded transport', () => {
  const transport = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname.includes('trades')) return new Response(trades);
    return Response.json(url.searchParams.has('page_token') ? { news: [{ ...article, id: 124 }], next_page_token: null } : news);
  });
  return { news: new AlpacaNewsProvider({ ...options, fetch: transport }), quotes: new AlpacaQuoteProvider({ ...options, fetch: transport }), known: { symbol: 'AAPL', exchangeMic: 'XNAS' }, unknown: { symbol: 'UNKNOWN', exchangeMic: 'XNAS' } };
});
describe('Alpaca transport', () => {
  it('advances a page containing documented null URLs without inventing links', async () => {
    const provider = new AlpacaNewsProvider({ ...options, fetch: async () => Response.json({ news: [{ ...article, url: null }], next_page_token: null }) });
    const page = await provider.getNews(); expect(page.articles).toEqual([]); expect(page.checkpoint).toBeTruthy();
  });
  it('pins window across pages, disables content and strips full text', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(news));
    const provider = new AlpacaNewsProvider({ ...options, fetch: transport });
    const first = await provider.getNews();
    await provider.getNews({ checkpoint: first.checkpoint });
    const a = new URL(String(transport.mock.calls[0]![0])), b = new URL(String(transport.mock.calls[1]![0]));
    expect(a.searchParams.get('end')).toBe(b.searchParams.get('end'));
    expect(b.searchParams.get('page_token')).toBe('page-2');
    expect(a.searchParams.get('include_content')).toBe('false');
    expect(first.articles[0]).not.toHaveProperty('content');
    expect(JSON.stringify(first)).not.toContain('FULL TEXT');
  });
  it('preserves decimal digits and refuses ambiguous identities', async () => {
    const provider = new AlpacaQuoteProvider({ ...options, fetch: async () => new Response(trades) });
    expect((await provider.getQuotes([{ symbol: 'AAPL', exchangeMic: 'XNAS' }])).quotes[0]?.price).toBe('123.1234567890');
    expect((await provider.getQuotes([{ symbol: 'AAPL', exchangeMic: 'XNAS' }, { symbol: 'AAPL', exchangeMic: 'XNYS' }])).quotes).toEqual([]);
  });
  it('respects rate reset and Retry-After, sanitizes auth/network/schema failures', async () => {
    const provider = new AlpacaNewsProvider({ ...options, fetch: async () => new Response('secret response', { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Reset': String(clock.now().getTime() / 1000 + 120) } }) });
    await expect(provider.getNews()).rejects.toMatchObject({ code: 'rate_limit', retryAt: '2026-10-02T12:02:00.000Z', message: 'Provider rate_limit' });
    for (const status of [401, 403, 503]) await expect(new AlpacaNewsProvider({ ...options, fetch: async () => new Response('secret', { status }) }).getNews()).rejects.toMatchObject({ code: status === 503 ? 'outage' : 'not_configured' });
    await expect(new AlpacaNewsProvider({ ...options, fetch: async () => Response.json({ news: [{}] }) }).getNews()).rejects.toMatchObject({ code: 'outage' });
    await expect(new AlpacaNewsProvider({ ...options, fetch: async () => { throw new Error('secret'); } }).getNews()).rejects.toMatchObject({ message: 'Provider outage' });
  });
  it('aborts a hung HTTP request and denies unconfirmed rights', async () => {
    const provider = new AlpacaNewsProvider({ ...options, timeoutMs: 5, fetch: (_input, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))) });
    await expect(provider.getNews()).rejects.toMatchObject({ code: 'outage' });
    expect(() => new AlpacaNewsProvider({ ...options, rightsConfirmed: false })).toThrow('not_configured');
  });
});
