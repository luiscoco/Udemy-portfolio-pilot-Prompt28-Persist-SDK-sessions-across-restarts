import { expect, test } from '@playwright/test';

test('credential-free mock polling, provenance, fresh news and stale failure labels', async ({ page }) => {
  test.setTimeout(60000); // Three 5-second polling transitions plus sign-in and initial compilation.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.demo-badge')).toContainText('MOCK DATA');
  await expect(page.locator('.demo-badge')).toContainText('Synthetic');
  await expect(page.locator('.news-item').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.news-item').first()).toContainText('Ingested');
  await expect(page.locator('.news-item').first()).toContainText('Delayed 1000 ms');
  await expect(page.getByText('ACME / XNAS: USD 125.00', { exact: false })).toBeVisible();
  const before = await page.locator('.news-item h3').first().innerText();
  await expect.poll(async () => page.locator('.news-item h3').first().innerText(), { timeout: 15000 }).not.toBe(before);
  const snapshot = await (await page.request.get('/api/market')).json();
  expect(snapshot.mode).toBe('mock'); expect(snapshot.status).toBe('fresh');
  await page.screenshot({ path: 'test-results/provider-fresh.png', fullPage: true });
  await page.route('**/api/market', route => route.fulfill({ json: { ...snapshot, status: 'stale', error: 'outage' } }));
  await expect(page.locator('.demo-badge')).toContainText('stale', { timeout: 15000 });
  await expect(page.locator('.news-item').first()).toContainText('Stale');
  await page.route('**/api/market', route => route.fulfill({ json: { ...snapshot, mode: 'live', status: 'unavailable', error: 'not_configured', fetchedAt: null, quotes: [], articles: [], providers: [] } }));
  await expect(page.locator('.demo-badge')).toContainText('LIVE DATA', { timeout: 15000 });
  await expect(page.locator('.demo-badge')).toContainText('unavailable');
  await expect(page.locator('.news-item')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/provider-unavailable.png', fullPage: true });
});
