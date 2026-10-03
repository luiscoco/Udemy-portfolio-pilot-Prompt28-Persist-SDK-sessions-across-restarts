import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { invalidateEvent, StreamManager } from './stream-manager';

const base = { id: '11111111-1111-4111-8111-111111111111', schemaVersion: 1 as const, occurredAt: '2026-10-02T10:00:00.000Z' };
describe('stream cache reconciliation', () => {
  it('refreshes durable alert and recommendation reads for sanitized research notifications', async () => {
    const cache = new QueryClient();
    for (const key of [['alert-notifications'], ['alert-rules'], ['recommendations', 'history'], ['news-impact', 'story'], ['health']]) cache.setQueryData(key, {});
    invalidateEvent(cache, { ...base, type: 'research.updated', resourceId: 'notification', change: 'notification.created' });
    await vi.waitFor(() => expect(cache.getQueryState(['alert-notifications'])?.isInvalidated).toBe(true));
    expect(cache.getQueryState(['recommendations', 'history'])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(['alert-rules'])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(['health'])?.isInvalidated).toBe(false);
    cache.clear();
  });
  it('refreshes private research when holdings or any cited article changes', async () => {
    for (const event of [
      { ...base, type: 'portfolio.updated' as const, portfolioId: 'a', change: 'transaction.recorded' as const, transactionId: 'trade' },
      { ...base, type: 'news.available' as const, articleId: 'cited-story', change: 'correction' as const, portfolioIds: ['a'], securityIds: ['acme'], watchlisted: false }
    ]) {
      const cache = new QueryClient();
      cache.setQueryData(['news-impact', 'other-story'], {}); cache.setQueryData(['recommendations'], {});
      invalidateEvent(cache, event);
      await vi.waitFor(() => expect(cache.getQueryState(['news-impact', 'other-story'])?.isInvalidated).toBe(true));
      expect(cache.getQueryState(['recommendations'])?.isInvalidated).toBe(true);
      cache.clear();
    }
  });
  it('targets portfolio and its ledger without invalidating unrelated reads', async () => {
    const cache = new QueryClient();
    for (const key of [['portfolios'], ['summary', 'a'], ['summary', 'b'], ['transactions', 'a', 0], ['watchlist'], ['health']]) cache.setQueryData(key, {});
    invalidateEvent(cache, { ...base, type: 'portfolio.updated', portfolioId: 'a', change: 'transaction.recorded', transactionId: 'trade' });
    await vi.waitFor(() => expect(cache.getQueryState(['summary', 'a'])?.isInvalidated).toBe(true));
    expect(cache.getQueryState(['transactions', 'a', 0])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(['summary', 'b'])?.isInvalidated).toBe(false);
    expect(cache.getQueryState(['watchlist'])?.isInvalidated).toBe(false);
    expect(cache.getQueryState(['health'])?.isInvalidated).toBe(false);
  });
  it('targets quote securities and matching valuations; news targets authorized feeds', async () => {
    const cache = new QueryClient();
    cache.setQueryData(['summary', 'a'], { summary: { positions: [{ securityId: 'acme' }] } });
    cache.setQueryData(['summary', 'b'], { summary: { positions: [{ securityId: 'nova' }] } });
    for (const key of [['quotes', 'acme'], ['quotes', 'nova'], ['news', null], ['news', 'a'], ['news', 'b']]) cache.setQueryData(key, {});
    invalidateEvent(cache, { ...base, type: 'quote.updated', quotes: [{ securityId: 'acme', asOf: base.occurredAt }] });
    invalidateEvent(cache, { ...base, type: 'news.available', articleId: 'story', change: 'correction', portfolioIds: ['a'], securityIds: ['acme'], watchlisted: false });
    await vi.waitFor(() => expect(cache.getQueryState(['news', 'a'])?.isInvalidated).toBe(true));
    expect(cache.getQueryState(['summary', 'a'])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(['quotes', 'acme'])?.isInvalidated).toBe(true);
    for (const key of [['summary', 'b'], ['quotes', 'nova'], ['news', 'b']]) expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
  });
  it('cancels a pre-event first fetch and starts a fresh read instead of coalescing', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let reads = 0; let aborted = false;
    const observer = new QueryObserver(cache, { queryKey: ['portfolios'], queryFn: ({ signal }) => {
      reads++;
      if (reads > 1) return Promise.resolve({ portfolios: ['new'] });
      return new Promise(resolve => { signal.addEventListener('abort', () => { aborted = true; resolve({ portfolios: ['old'] }); }); });
    } });
    const unsubscribe = observer.subscribe(() => {});
    invalidateEvent(cache, { ...base, type: 'portfolio.updated', portfolioId: 'a', change: 'renamed', transactionId: null });
    await vi.waitFor(() => expect(cache.getQueryData(['portfolios'])).toEqual({ portfolios: ['new'] }));
    expect(aborted).toBe(true); expect(reads).toBe(2); unsubscribe(); cache.clear();
  });
  it('does not apply queued invalidations after an auth scope has been closed', async () => {
    const cache = new QueryClient(); cache.setQueryData(['portfolios'], {});
    invalidateEvent(cache, { ...base, type: 'portfolio.updated', portfolioId: 'a', change: 'renamed', transactionId: null }, () => false);
    await Promise.resolve(); await Promise.resolve();
    expect(cache.getQueryState(['portfolios'])?.isInvalidated).toBe(false);
  });
});

it('StrictMode subscriptions share recovery and unmount aborts it', async () => {
  const target = new EventTarget();
  vi.stubGlobal('window', target); vi.stubGlobal('navigator', { onLine: true });
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_path: string, options: RequestInit) => { signal = options.signal as AbortSignal; return new Promise<Response>(() => {}); });
  vi.stubGlobal('fetch', fetch);
  const manager = new StreamManager('alice', new QueryClient());
  const first = manager.subscribe(() => {}); first();
  const second = manager.subscribe(() => {});
  await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(1); expect(signal?.aborted).toBe(false);
  second(); await Promise.resolve(); expect(signal?.aborted).toBe(true);
  vi.unstubAllGlobals();
});
