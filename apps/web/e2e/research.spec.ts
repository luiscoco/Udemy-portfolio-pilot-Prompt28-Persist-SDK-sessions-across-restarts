import { expect, test } from '@playwright/test';
import { closeConnections, getDatabase } from '@portfolio-pilot/db';

const url = process.env.RESEARCH_E2E_DATABASE_URL;
test.describe('persisted portfolio research', () => {
  test.skip(!url, 'Set RESEARCH_E2E_DATABASE_URL and run the mock API on portfolio_m21_verify.');
  test.beforeAll(() => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/portfolio_m21_verify') throw new Error('Use the dedicated loopback research database.');
  });
  test.afterAll(async () => { await closeConnections(); });

  test('analyzes in news detail, persists caveats and rejects a different owner', async ({ page, browser }) => {
    test.setTimeout(60000);
    const run = `research-ui-${crypto.randomUUID().slice(0, 8)}`;
    const db = await getDatabase(url!);
    const bob = await browser.newContext();
    const title = `${run} raises guidance in a fictional filing`;
    try {
      await db.security.create({ data: { id: run, symbol: `R${run.slice(-8).toUpperCase()}`, exchangeMic: 'XNAS', name: run, currency: 'USD' } });
      await db.portfolio.create({ data: { id: run, ownerId: 'demo-alice', name: run, transactions: { create: { securityId: run, side: 'BUY', quantity: '6', price: '100', fees: '0', amount: '600', occurredAt: new Date('2025-01-01T00:00:00Z') } } } });
      await db.newsArticle.create({ data: { id: run, provider: 'synthetic-fixture', providerArticleId: run, title, summary: 'Fictional teaching fixture. The regulatory filing reports strong revenue growth.', url: `https://example.invalid/${run}`, publishedAt: new Date(Date.now() - 4 * 86400000), isSynthetic: true, securities: { create: [{ securityId: run }] } } });
      await page.goto('/news'); await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
      await page.getByLabel('News filter').selectOption(run);
      await page.getByRole('button', { name: title, exact: true }).click();
      const research = page.getByRole('region', { name: 'Research recommendations' });
      await research.getByRole('button', { name: 'Analyze impact', exact: true }).click();
      await expect(research.getByRole('article', { name: 'Monitor event recommendation' })).toBeVisible();
      await expect(research.getByRole('article', { name: 'Review concentration recommendation' })).toBeVisible();
      await expect(research.getByRole('article', { name: 'Read primary source recommendation' })).toBeVisible();
      await expect(research).toContainText('Older than 72 hours');
      await expect(research).toContainText('not a forecast or a calibrated probability');
      await expect(research).toContainText('Counterarguments');
      await expect(research).toContainText('Weights use cost basis');
      const link = research.getByRole('link').first();
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await page.reload();
      await page.getByLabel('News filter').selectOption(run);
      await page.getByRole('button', { name: title, exact: true }).click();
      await expect(research.getByRole('article', { name: 'Monitor event recommendation' })).toBeVisible();
      const current = await page.request.get(`/api/news/${run}/impact`);
      expect(current.status()).toBe(200);
      expect(await db.articleAnalysis.count({ where: { articleId: run } })).toBe(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
      await page.screenshot({ path: 'test-results/research-mobile.png', fullPage: true });
      const bobPage = await bob.newPage();
      await bobPage.goto('/news');
      const signedIn = bobPage.waitForResponse(r => r.url().endsWith('/api/auth/demo-sign-in') && r.request().method() === 'POST');
      await bobPage.getByRole('button', { name: 'Sign in as Bob Demo' }).click();
      expect((await signedIn).status()).toBe(200);
      await expect(bobPage.getByRole('region', { name: 'Authenticated session' })).toContainText('Bob');
      expect((await bob.request.get(`/api/news/${run}/impact`)).status()).toBe(404);
      expect((await bob.request.post(`/api/news/${run}/impact`, { headers: { origin: 'http://127.0.0.1:5173' } })).status()).toBe(404);
    } finally {
      await bob.close();
      await db.recommendation.deleteMany({ where: { articleId: run } });
      await db.newsArticle.deleteMany({ where: { id: run } });
      await db.portfolio.deleteMany({ where: { id: run } });
      await db.security.deleteMany({ where: { id: run } });
    }
  });
});
