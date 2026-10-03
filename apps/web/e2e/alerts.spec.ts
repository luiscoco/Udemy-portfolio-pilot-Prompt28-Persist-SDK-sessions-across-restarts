import { expect, test } from '@playwright/test';
import { MockArticleAnalyzer, analyzeArticle, ARTICLE_ANALYSIS_PROMPT_VERSION } from '@portfolio-pilot/agent';
import { ARTICLE_ANALYSIS_SCHEMA_VERSION } from '@portfolio-pilot/contracts';
import { closeConnections, getDatabase, getRedis, ingestionRepository, outboxRepository, processResearchNews, publishEvent, redisKeys } from '@portfolio-pilot/db';
import { injectFixture } from '../../worker/dist/fixture.js';
import { dispatchOnce } from '../../worker/dist/outbox.js';

const url = process.env.ALERT_E2E_DATABASE_URL;
test.describe('news to recommendations and configurable alerts', () => {
  test.skip(!url, 'Run mock dev servers on portfolio_m22_verify and set ALERT_E2E_DATABASE_URL.');
  test.afterAll(async () => { await closeConnections(); });
  test('creates an alert, recovers once after reconnect, saves/dismisses persistently and isolates another user', async ({ page, browser, context }) => {
    test.setTimeout(90000);
    const target = new URL(url!); if (target.hostname !== '127.0.0.1' || target.pathname !== '/portfolio_m22_verify') throw new Error('Dedicated database required');
    const db = await getDatabase(url!); const run = `alerts-ui-${crypto.randomUUID().slice(0, 8)}`;
    const bob = await browser.newContext(); let ruleId = '', articleId = '';
    const analyzer = new MockArticleAnalyzer();
    const binding = { mode: analyzer.mode, modelKey: analyzer.modelKey, promptVersion: ARTICLE_ANALYSIS_PROMPT_VERSION, schemaVersion: ARTICLE_ANALYSIS_SCHEMA_VERSION,
      run: (input: Parameters<typeof analyzeArticle>[1], signal?: AbortSignal) => analyzeArticle(analyzer, input, signal) };
    try {
      await db.watchlistEntry.upsert({ where: { ownerId_securityId: { ownerId: 'demo-alice', securityId: 'demo-nova' } }, create: { ownerId: 'demo-alice', securityId: 'demo-nova' }, update: {} });
      await page.goto('/research'); await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
      await page.getByRole('link', { name: 'Research & alerts' }).click();
      await page.getByLabel('Rule name', { exact: true }).fill(run);
      await page.getByLabel('Watched securities', { exact: true }).selectOption('demo-nova');
      await page.getByLabel('Cooldown seconds', { exact: true }).fill('0');
      await page.getByRole('button', { name: 'Create alert rule' }).click();
      await expect(page.getByRole('button', { name: `Edit ${run}` })).toBeVisible();
      ruleId = (await db.alertRule.findFirstOrThrow({ where: { ownerId: 'demo-alice', name: run } })).id;
      await context.setOffline(true);
      const input = { id: run, revision: 1, publishedAt: new Date().toISOString() };
      const env = { ...process.env, NODE_ENV: 'development', DATA_MODE: 'mock', DATABASE_URL: url! };
      await injectFixture(ingestionRepository(db), input, env); await injectFixture(ingestionRepository(db), input, env);
      articleId = (await db.newsSource.findUniqueOrThrow({ where: { provider_recordId: { provider: 'development-fixture', recordId: run } } })).articleId;
      for (let i = 0; i < 4; i++) await dispatchOnce(outboxRepository(db), async event => publishEvent(await getRedis('redis://127.0.0.1:6379'), redisKeys(), event), {
        owner: run, batchSize: 100, leaseMs: 120000, maxAttempts: 8, processNews: id => processResearchNews(db, id, binding)
      });
      await context.setOffline(false);
      const notice = page.getByRole('article', { name: 'Alert notification', exact: true }).filter({ hasText: run });
      await expect(notice).toHaveCount(1); await expect(notice).toContainText('New');
      expect(await db.alertNotification.count({ where: { ruleId } })).toBe(1);
      const id = (await db.alertNotification.findFirstOrThrow({ where: { ruleId } })).recommendationIds[0]!;
      const recommendation = await db.recommendation.findUniqueOrThrow({ where: { id } });
      const title = (recommendation.payload as { title: string }).title;
      const card = page.locator(`[data-recommendation-id="${id}"]`);
      await expect(card).toBeVisible(); await expect(card).toContainText('Evidence'); await expect(card).toContainText('published');
      await card.getByRole('button', { name: 'Save', exact: true }).click(); await expect(card).toContainText('Status: saved');
      await card.getByText('Explanation and caveats', { exact: true }).click(); await expect(card.getByRole('heading', { name: 'Uncertainties' })).toBeHidden();
      await card.getByText('Explanation and caveats', { exact: true }).click(); await expect(card.getByRole('heading', { name: 'Uncertainties' })).toBeVisible();
      await card.getByRole('button', { name: 'Dismiss', exact: true }).click(); await expect(card).toHaveCount(0);
      await notice.getByRole('button', { name: 'Dismiss alert' }).click(); await expect(notice).toContainText('Dismissed');
      await page.reload(); await expect(notice).toHaveCount(1); await expect(notice).toContainText('Dismissed');
      await page.getByLabel('Show recommendations').selectOption('history'); await expect(card).toContainText('Status: dismissed');
      await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
      await page.screenshot({ path: 'test-results/alerts-mobile.png', fullPage: true });
      const bobPage = await bob.newPage(); await bobPage.goto('/research'); await bobPage.getByRole('button', { name: 'Sign in as Bob Demo' }).click();
      await bobPage.getByRole('link', { name: 'Research & alerts' }).click();
      await expect(bobPage.getByRole('region', { name: 'Configurable alerts' })).not.toContainText(run);
      expect((await bob.request.patch(`/api/recommendations/${id}`, { headers: { origin: 'http://127.0.0.1:5173' }, data: { disposition: 'saved' } })).status()).toBe(404);
      const other = await bob.request.get('/api/recommendations?status=history'); expect(JSON.stringify(await other.json())).not.toContain(id);
    } finally {
      await context.setOffline(false); await bob.close();
      if (ruleId) await db.alertRule.deleteMany({ where: { id: ruleId } });
      if (articleId) { await db.recommendation.deleteMany({ where: { articleId } }); await db.newsArticle.deleteMany({ where: { id: articleId } }); }
    }
  });
});

