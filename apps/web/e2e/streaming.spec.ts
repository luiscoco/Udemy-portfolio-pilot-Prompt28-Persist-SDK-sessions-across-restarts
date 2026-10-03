import { expect, test, type Page } from '@playwright/test';

const at = '2026-10-02T10:00:00.000Z';
const portfolio = (name: string, id = 'alice-portfolio') => ({ id, name, currency: 'USD', archivedAt: null, createdAt: at, updatedAt: at });
const snapshot = (name: string, cursor: string, id = 'alice-portfolio') => ({ cursor,
  streams: { user: 'v1.11111111-1111-4111-8111-111111111111.0-0', market: 'v1.11111111-1111-4111-8111-111111111111.0-0' },
  retention: { replayWindowMs: 60000, userStreamMaxEntries: 100, marketStreamMaxEntries: 100 },
  portfolios: [portfolio(name, id)], watchlist: [], news: { portfolioId: null, articles: [], generatedAt: at }, snapshotAt: at });
async function setup(page: Page, controlledTransport = true) {
  // Controlled transport in a real StrictMode app. No production test hooks/endpoints.
  if (controlledTransport) await page.addInitScript(() => {
    const sources: Array<EventTarget & { url: string; closed: boolean }> = [];
    class Source extends EventTarget {
      closed = false; onopen: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(public url: string) { super(); sources.push(this); queueMicrotask(() => this.onopen?.()); }
      close() { this.closed = true; }
    }
    Object.assign(window, { EventSource: Source, streamTest: {
      sources,
      emit(type: string, payload: unknown, cursor: string) { sources.at(-1)?.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload), lastEventId: cursor })); },
      disconnect() { (sources.at(-1) as Source).onerror?.(); }
    } });
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 'alice', name: 'Alice', email: 'alice@example.test' }, expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  await page.route('**/api/auth/options', route => route.fulfill({ json: { demo: true, microsoft: false } }));
  await page.route('**/api/events/recovery', route => route.fulfill({ json: snapshot('Snapshot name', 'alice-start') }));
  await page.route('**/api/portfolios', route => route.fulfill({ json: { portfolios: [portfolio('Updated by event')] } }));
}
async function emit(page: Page, type: string, fields: object, cursor: string, id = '11111111-1111-4111-8111-111111111111') {
  await page.evaluate(({ type, fields, cursor, id, at }) => {
    (window as any).streamTest.emit(type, { type, id, schemaVersion: 1, occurredAt: at, ...fields }, cursor);
  }, { type, fields, cursor, id, at });
}

test('StrictMode shares one connection; targeted updates dedupe UUIDs independently of cursors', async ({ page }) => {
  await setup(page);
  let listReads = 0;
  await page.route('**/api/portfolios', route => { listReads++; return route.fulfill({ json: { portfolios: [portfolio('Updated by event')] } }); });
  await page.goto('/');
  await expect(page.getByLabel('Update connection')).toContainText('Live');
  await expect(page.getByLabel('Portfolio')).toContainText('Snapshot name');
  expect(await page.evaluate(() => (window as any).streamTest.sources.length)).toBe(1);
  await emit(page, 'portfolio.updated', { portfolioId: 'alice-portfolio', change: 'renamed', transactionId: null }, 'alice-1');
  await expect(page.getByLabel('Portfolio')).toContainText('Updated by event');
  await emit(page, 'portfolio.updated', { portfolioId: 'alice-portfolio', change: 'renamed', transactionId: null }, 'alice-2');
  expect(listReads).toBe(1);
  await page.evaluate(() => (window as any).streamTest.disconnect());
  await expect(page.getByLabel('Update connection')).toContainText('Reconnecting');
  await expect.poll(() => page.evaluate(() => (window as any).streamTest.sources.at(-1).url)).toContain('alice-2');
  await expect(page.getByLabel('Update connection')).toContainText('Live');
});

test('native browser SSE replays from snapshot and reconnect cursor without refresh', async ({ page }) => {
  await setup(page, false);
  const cursors: string[] = [];
  let name = 'Snapshot name';
  let releaseReconnect!: () => void;
  const reconnect = new Promise<void>(resolve => { releaseReconnect = resolve; });
  await page.route('**/api/portfolios', route => route.fulfill({ json: { portfolios: [portfolio(name)] } }));
  await page.route('**/api/events?*', async route => {
    cursors.push(new URL(route.request().url()).searchParams.get('cursor')!);
    const count = cursors.length;
    if (count > 1) await reconnect;
    name = count === 1 ? 'Committed during snapshot' : 'Caught up after disconnect';
    const event = { ...{ id: count === 1 ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222', schemaVersion: 1, occurredAt: at },
      type: 'portfolio.updated', portfolioId: 'alice-portfolio', change: 'renamed', transactionId: null };
    await route.fulfill({ contentType: 'text/event-stream', body: `id: replay-${count}\nevent: portfolio.updated\ndata: ${JSON.stringify(event)}\n\n` });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Portfolio')).toContainText('Committed during snapshot');
  releaseReconnect();
  await expect(page.getByLabel('Portfolio')).toContainText('Caught up after disconnect');
  expect(cursors.slice(0, 2)).toEqual(['alice-start', 'replay-1']);
});

test('news notifications update the relevant persisted feed without refreshing unrelated queries', async ({ page }) => {
  await setup(page);
  let newsReads = 0; let portfolioReads = 0;
  await page.route('**/api/portfolios', route => { portfolioReads++; return route.fulfill({ json: { portfolios: [portfolio('Snapshot name')] } }); });
  await page.route('**/api/news', route => {
    newsReads++;
    return route.fulfill({ json: { portfolioId: null, generatedAt: at, articles: [{ id: 'story', provider: 'mock', title: 'New relevant story', summary: 'Persisted by ingestion', url: 'https://example.test/story', publishedAt: at, updatedAt: at, isSynthetic: true, securities: [] }] } });
  });
  await page.goto('/news');
  await expect(page.getByLabel('Update connection')).toContainText('Live');
  await expect(page.getByRole('region', { name: 'Portfolio and watchlist news' })).toContainText('No relevant stories yet.');
  await emit(page, 'news.available', { articleId: 'story', change: 'new', securityIds: ['acme'], portfolioIds: ['alice-portfolio'], watchlisted: false }, 'news-1');
  await expect(page.getByRole('button', { name: 'Show updates' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New relevant story' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show updates' }).click();
  await expect(page.getByRole('heading', { name: 'New relevant story' })).toBeVisible();
  expect(newsReads).toBe(1); expect(portfolioReads).toBe(0);
});

test('quote notification refreshes the affected holding valuation without a page refresh', async ({ page }) => {
  await setup(page);
  let price = '100'; let reads = 0;
  await page.route('**/api/portfolios/alice-portfolio/summary', route => {
    reads++;
    return route.fulfill({ json: { summary: {
      portfolioId: 'alice-portfolio', name: 'Snapshot name', currency: 'USD', asOf: at, staleAfterMs: 60000,
      valuationComplete: true, remainingCostBasis: '50', soldCostBasis: '0', realizedGainLoss: '0', marketValue: price, unrealizedGainLoss: '50',
      positions: [{ securityId: 'acme', security: { symbol: 'ACME', exchangeMic: 'XNAS', currency: 'USD' },
        remainingQuantity: '1', weightedAverageAcquisitionCost: '50', remainingCostBasis: '50', soldCostBasis: '0', realizedGainLoss: '0',
        marketValue: price, unrealizedGainLoss: '50', allocationWeight: '1', quoteStatus: 'fresh',
        quote: { securityId: 'acme', price, currency: 'USD', asOf: at, provider: 'mock', isSynthetic: true } }]
    } } });
  });
  await page.goto('/');
  const holdings = page.getByRole('table', { name: 'Portfolio holdings' });
  await expect(holdings).toContainText('USD 100.00');
  price = '125';
  await emit(page, 'quote.updated', { quotes: [{ securityId: 'acme', asOf: at }] }, 'quote-1');
  await expect(holdings).toContainText('USD 125.00');
  expect(reads).toBe(2);
});

test('offline catch-up, retained-event expiry and invalid payload recover from authorized snapshot', async ({ page, context }) => {
  await setup(page); await page.goto('/');
  await expect(page.getByLabel('Update connection')).toContainText('Live');
  await context.setOffline(true);
  await expect(page.getByLabel('Update connection')).toContainText('Offline');
  await context.setOffline(false);
  await expect(page.getByLabel('Update connection')).toContainText('Live');
  await page.route('**/api/events/recovery', route => route.fulfill({ json: snapshot('Recovered during outage', 'alice-new') }));
  await emit(page, 'stream.reset', { reason: 'expired', recoveryUrl: '/api/events/recovery' }, '');
  await expect(page.getByLabel('Portfolio')).toContainText('Recovered during outage');
  await expect.poll(() => page.evaluate(() => (window as any).streamTest.sources.at(-1).url)).toContain('alice-new');
  await emit(page, 'portfolio.updated', { portfolioId: 'alice-portfolio', change: 'renamed', transactionId: null, secret: 'reject' }, 'bad');
  await expect.poll(() => page.evaluate(() => (window as any).streamTest.sources.length)).toBe(4);
});

test('logout closes connection and user switch cannot reuse Alice cache or cursor', async ({ page }) => {
  await setup(page); await page.goto('/');
  await expect(page.getByLabel('Update connection')).toContainText('Live');
  await emit(page, 'portfolio.updated', { portfolioId: 'alice-portfolio', change: 'renamed', transactionId: null }, 'alice-private');
  await page.route('**/api/auth/sign-out', route => route.fulfill({ json: {} }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in as Bob Demo' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).streamTest.sources.every((s: any) => s.closed))).toBe(true);
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 'bob', name: 'Bob', email: 'bob@example.test' }, expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  await page.route('**/api/auth/demo-sign-in', route => route.fulfill({ json: {} }));
  await page.route('**/api/events/recovery', route => route.fulfill({ json: snapshot('Bob private portfolio', 'bob-start', 'bob-portfolio') }));
  await page.getByRole('button', { name: 'Sign in as Bob Demo' }).click();
  await expect(page.getByLabel('Portfolio')).toContainText('Bob private portfolio');
  await expect(page.getByLabel('Portfolio')).not.toContainText('Updated by event');
  expect(await page.evaluate(() => (window as any).streamTest.sources.at(-1).url)).toContain('bob-start');
});
