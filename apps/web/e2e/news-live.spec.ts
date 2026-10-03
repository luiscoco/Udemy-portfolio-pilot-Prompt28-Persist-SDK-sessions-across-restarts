import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const exec = promisify(execFile);
test.skip(process.env.NEWS_E2E !== 'true', 'Requires the seeded local *_verify API, PostgreSQL and Redis (lesson 16).');
test('real ingestion → outbox → Redis → authenticated API SSE → two-user React feed', async ({ browser }) => {
  test.setTimeout(120000);
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (database.hostname !== '127.0.0.1' || !database.pathname.endsWith('_verify')) throw new Error('Use a disposable loopback *_verify database');
  const root = resolve('../..');
  const id = `browser-${Date.now()}`;
  async function inject(revision: number) {
    await exec(process.execPath, [resolve(root, 'apps/worker/dist/inject-fixture.js'), id, String(revision)], { cwd: root, env: { ...process.env, NODE_ENV: 'development', DATA_MODE: 'mock' } });
    // Two passes: global internal event fans out first, owner delivery follows.
    for (let i = 0; i < 2; i++) await exec(process.execPath, [resolve(root, 'apps/worker/dist/index.js')], { cwd: root, env: { ...process.env, NODE_ENV: 'development', DATA_MODE: 'mock', WORKER_ROLE: 'outbox', WORKER_ONCE: 'true' } });
  }
  const aliceContext = await browser.newContext(), bobContext = await browser.newContext();
  const alice = await aliceContext.newPage(), bob = await bobContext.newPage();
  try {
    for (const [context, account] of [[aliceContext, 'alice'], [bobContext, 'bob']] as const) {
      const response = await context.request.post('/api/auth/demo-sign-in', { data: { account }, headers: { origin: 'http://127.0.0.1:5173' } });
      expect(response.status()).toBe(200);
    }
    await Promise.all([alice.goto('/news'), bob.goto('/news')]);
    await expect(alice.getByLabel('Update connection')).toContainText('Live');
    await expect(bob.getByLabel('Update connection')).toContainText('Live');
    const title = `Fixture ${id}: NOVA opens a fictional laboratory`;
    const correction = `Correction ${id}: NOVA laboratory opening postponed`;
    await alice.getByLabel('News filter').selectOption('watchlist');
    await expect(alice.getByRole('heading', { name: 'Portfolio and watchlist news', exact: true })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Synthetic scenario: Nova Fictional Labs announces a fictional lab', exact: true })).toBeVisible();
    await alice.setViewportSize({ width: 1000, height: 450 });
    await alice.evaluate(() => window.scrollTo(0, 200));
    const before = await alice.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);
    await inject(1);
    await expect(alice.getByRole('button', { name: 'Show updates' })).toBeVisible();
    expect(await alice.evaluate(() => window.scrollY)).toBe(before);
    await expect(alice.getByRole('button', { name: title, exact: true })).toHaveCount(0);
    await alice.getByRole('button', { name: 'Show updates' }).click();
    await expect(alice.getByRole('button', { name: title, exact: true })).toHaveCount(1);
    const feed = await (await aliceContext.request.get('/api/news?scope=watchlist')).json();
    const article = feed.articles.find((a: any) => a.title === title);
    expect(article).toBeTruthy();
    expect((await (await bobContext.request.get('/api/news')).json()).articles.some((a: any) => a.id === article.id)).toBe(false);
    expect((await bobContext.request.get(`/api/news/${article.id}`)).status()).toBe(404);
    expect((await bobContext.request.post(`/api/news/${article.id}/read`, { headers: { origin: 'http://127.0.0.1:5173' } })).status()).toBe(404);
    await expect(bob.getByText(title, { exact: true })).toHaveCount(0);
    await inject(1);
    await expect(alice.getByRole('button', { name: title, exact: true })).toHaveCount(1);
    await expect(alice.getByRole('button', { name: 'Show updates' })).toHaveCount(0);
    await alice.getByRole('button', { name: title, exact: true }).click();
    const dialog = alice.getByRole('dialog');
    await expect(dialog.getByRole('region', { name: 'Portfolio impact' })).toContainText('4 shares');
    await expect(dialog).toContainText('MOCK · Synthetic');
    await expect(dialog).toContainText('Delayed 1000 ms');
    await dialog.getByRole('button', { name: 'Mark article read' }).click();
    await expect(dialog).toContainText('Read this revision');
    await dialog.getByRole('button', { name: 'Close news detail' }).click();
    await inject(2);
    await expect(alice.getByRole('button', { name: 'Show updates' })).toBeVisible();
    await expect(alice.getByRole('button', { name: title, exact: true })).toHaveCount(1);
    await alice.getByRole('button', { name: 'Show updates' }).click();
    await expect(alice.getByRole('button', { name: correction, exact: true })).toHaveCount(1);
    await expect(alice.locator('article').filter({ has: alice.getByRole('button', { name: correction, exact: true }) }).getByText('Updated since you read it', { exact: true })).toBeVisible();
    const detail = await (await aliceContext.request.get(`/api/news/${article.id}`)).json();
    expect(detail.article.id).toBe(article.id); expect(detail.article.revision).toBe(2);
    expect(detail.provenance).toHaveLength(2);
    expect(detail.article.readRevisionAt).not.toBe(detail.article.updatedAt);
    await inject(2); await inject(1); // Repeated correction and stale delivery cannot regress freshness.
    const latest = await (await aliceContext.request.get(`/api/news/${article.id}`)).json();
    expect(latest.article.title).toBe(correction); expect(latest.provenance).toHaveLength(2);
    await expect(alice.getByRole('button', { name: 'Show updates' })).toHaveCount(0);
    await alice.reload();
    await expect(alice.getByRole('button', { name: correction, exact: true })).toHaveCount(1);
    await expect(bob.getByText(correction, { exact: true })).toHaveCount(0);
  } finally { await aliceContext.close(); await bobContext.close(); }
});
