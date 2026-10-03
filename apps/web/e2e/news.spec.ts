import { expect, test } from '@playwright/test';

test('news pagination, inert provider text, safe links and keyboard detail focus', async ({ page }) => {
  const at = '2026-10-02T10:00:00.000Z';
  const article = (id: string, url = 'https://example.test/canonical') => ({ id, title: id === 'first' ? '<img src=x onerror="window.pwned=1">' : 'Second page article', summary: '<script>window.pwned=1</script>', provider: 'mock', url, isSynthetic: true, publishedAt: at, updatedAt: at, ingestedAt: at, securities: [] });
  await page.addInitScript(() => {
    class Source extends EventTarget { onopen: (() => void) | null = null; onerror: (() => void) | null = null; constructor() { super(); Object.assign(window, { newsTestSource: this }); queueMicrotask(() => this.onopen?.()); } close() {} }
    Object.assign(window, { EventSource: Source });
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 'alice', name: 'Alice', email: 'alice@example.test' }, expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  await page.route('**/api/events/recovery', route => route.fulfill({ json: { cursor: 'start', streams: { user: null, market: null }, retention: { replayWindowMs: 10000, userStreamMaxEntries: 100, marketStreamMaxEntries: 100 }, portfolios: [], watchlist: [], snapshotAt: at, news: { portfolioId: null, generatedAt: at, articles: [article('first', 'javascript:alert(1)')], nextCursor: 'page2' } } }));
  await page.route('**/api/news?cursor=page2', route => route.fulfill({ json: { portfolioId: null, generatedAt: at, articles: [article('first'), article('second')], nextCursor: null } }));
  await page.route('**/api/news', route => route.fulfill({ json: { portfolioId: null, generatedAt: at, articles: [article('first', 'javascript:alert(1)')], nextCursor: 'page2' } }));
  await page.route('**/api/news/first', route => route.fulfill({ json: { article: article('first'), provenance: [], impacts: [], watchlisted: [] } }));
  await page.goto('/news');
  const title = page.getByRole('button', { name: '<img src=x onerror="window.pwned=1">', exact: true });
  await expect(title).toBeVisible();
  await expect(page.locator('.news-list img, .news-list script')).toHaveCount(0);
  await expect(page.getByText('Source link unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more articles' }).click();
  await expect(page.getByRole('button', { name: 'Second page article' })).toBeVisible();
  await expect(title).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load more articles' })).toHaveCount(0);
  await title.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Portfolio impact' })).toContainText('No current holdings');
  const link = dialog.getByRole('link', { name: 'Open canonical source (new tab)' });
  await expect(link).toHaveAttribute('href', 'https://example.test/canonical');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  await page.keyboard.press('Escape'); await expect(title).toBeFocused();
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  // A correction outside the first page still announces availability without replacing rows.
  await page.evaluate(at => (window as any).newsTestSource.dispatchEvent(new MessageEvent('news.available', { lastEventId: 'older-correction', data: JSON.stringify({ type: 'news.available', id: '11111111-1111-4111-8111-111111111111', schemaVersion: 1, occurredAt: at, articleId: 'second', change: 'correction', securityIds: [], portfolioIds: [], watchlisted: true }) })), at);
  await expect(page.getByRole('button', { name: 'Show updates' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Second page article' })).toBeVisible();
  await expect(title).toBeFocused();
});
