import { expect, test, type Page } from '@playwright/test';
import { closeConnections, getDatabase } from '@portfolio-pilot/db';

// Requires the API running against portfolio_m19_verify with AGENT_MODE=mock, REDIS_URL set and a
// visible mock pace (AGENT_MOCK_STREAM_DELAY_MS=80), so drafts and cancellation are observable.
const url = process.env.CHAT_E2E_DATABASE_URL;
const LARGEST = 'Your largest holding by current USD market value';

async function setup(page: Page, run: string) {
  const db = await getDatabase(url!);
  await db.security.create({ data: { id: run, symbol: `C${run.slice(-8).toUpperCase()}`, exchangeMic: 'XNAS', name: 'Fictional chat fixture', currency: 'USD' } });
  await db.quoteSnapshot.create({ data: { securityId: run, price: '125', currency: 'USD', provider: 'chat-ui', asOf: new Date(), isSynthetic: true } });
  await db.portfolio.create({ data: { id: run, ownerId: 'demo-alice', name: run, transactions: { create: { securityId: run, side: 'BUY', quantity: '9', price: '100', fees: '0', amount: '900', occurredAt: new Date('2025-01-01T00:00:00Z') } } } });
  await db.newsArticle.create({ data: { id: `${run}-news`, provider: 'chat-ui', providerArticleId: run, title: 'Fictional product review scheduled', summary: 'Synthetic reporting for browser acceptance.', url: `https://example.invalid/${run}`, publishedAt: new Date(), isSynthetic: true, securities: { create: [{ securityId: run }] } } });
  await page.goto('/assistant');
  await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
  await page.getByLabel('Scope for new conversation').selectOption(run);
  // Earlier conversations may already be selected; wait for the one this click creates.
  const created = page.waitForResponse(r => r.url().endsWith('/api/conversations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  const conversationId = (await (await created).json()).conversation.id as string;
  await expect(page.getByLabel('Conversation', { exact: true })).toHaveValue(conversationId);
  return { db, conversationId };
}
async function ask(page: Page, question: string) {
  await page.getByLabel('Ask about your portfolio').fill(question);
  const created = page.waitForResponse(r => /\/runs$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(202);
  return (await response.json()) as { run: { id: string; assistantMessageId: string }; replayCursor: string | null };
}
async function cleanup(run: string, conversationId: string) {
  const db = await getDatabase(url!);
  await db.conversation.deleteMany({ where: { OR: [{ portfolioId: run }, ...(conversationId ? [{ id: conversationId }] : [])] } });
  await db.newsArticle.deleteMany({ where: { id: `${run}-news` } });
  await db.portfolio.deleteMany({ where: { id: run } });
  await db.security.deleteMany({ where: { id: run } });
}

test.describe('streamed grounded chat', () => {
  test.skip(!url, 'Set CHAT_E2E_DATABASE_URL and run the API against portfolio_m19_verify.');
  test.beforeAll(() => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/portfolio_m19_verify') throw new Error('Use the dedicated loopback chat database.');
  });
  test.afterAll(async () => { await closeConnections(); });

  test('streams a draft with tool progress, then shows the persisted, cited answer exactly once', async ({ page, browser }) => {
    test.setTimeout(90000);
    const run = `chat-ui-${crypto.randomUUID().slice(0, 8)}`;
    let conversationId = '';
    const bob = await browser.newContext();
    try {
      ({ conversationId } = await setup(page, run));
      const created = await ask(page, 'Which recent news affects my largest holding?');
      expect(created.replayCursor).toMatch(/^s1\./);
      const draft = page.getByRole('article', { name: 'Answer in progress' });
      await expect(draft).toBeVisible();
      await expect(draft.getByRole('list', { name: 'Tool progress' })).toContainText('Searching stored news · done');
      await expect(draft).toContainText(LARGEST);
      await expect(page.getByRole('button', { name: 'Cancel answer' })).toBeVisible();
      await expect(page.getByText('Assistant · MOCK', { exact: true })).toBeVisible();
      await expect(draft).toHaveCount(0);
      // The duplicate-text bug would show the answer twice (deltas + appended final message).
      const messages = page.getByLabel('Conversation messages');
      await expect(messages.getByText(LARGEST, { exact: false })).toHaveCount(1);
      await expect(messages.getByText(LARGEST, { exact: false })).toContainText('1125.00 USD');
      await expect(messages.locator(`[data-message-id="${created.run.assistantMessageId}"]`)).toHaveCount(1);
      const link = page.getByRole('link', { name: `${run}-news`, exact: true }).first();
      await expect(link).toHaveAttribute('href', `https://example.invalid/${run}`);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await page.screenshot({ path: 'test-results/streamed-chat-desktop.png', fullPage: true });
      await page.reload();
      await page.getByLabel('Conversation', { exact: true }).selectOption(conversationId);
      await expect(page.getByText('Assistant · MOCK', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Conversation messages').getByText(LARGEST, { exact: false })).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
      await page.screenshot({ path: 'test-results/streamed-chat-mobile.png', fullPage: true });
      const bobPage = await bob.newPage();
      await bobPage.goto('/assistant'); await bobPage.getByRole('button', { name: 'Sign in as Bob Demo' }).click();
      await expect(bobPage.getByRole('heading', { name: 'Assistant', exact: true })).toBeVisible();
      const headers = { origin: 'http://127.0.0.1:5173' };
      expect((await bob.request.get(`/api/conversations/${conversationId}/messages`)).status()).toBe(404);
      expect((await bob.request.post(`/api/conversations/${conversationId}/runs`, { data: { content: 'news' }, headers })).status()).toBe(404);
      expect((await bob.request.get(`/api/runs/${created.run.id}`)).status()).toBe(404);
      expect((await bob.request.post(`/api/runs/${created.run.id}/cancel`, { headers })).status()).toBe(404);
      expect((await page.request.post(`/api/conversations/${conversationId}/messages`, { data: { content: 'news' }, headers })).status()).toBe(405);
    } finally { await bob.close(); await cleanup(run, conversationId); }
  });

  test('Cancel answer stops the run explicitly and persists a cancelled message', async ({ page }) => {
    test.setTimeout(60000);
    const run = `chat-cancel-${crypto.randomUUID().slice(0, 8)}`;
    let conversationId = '';
    try {
      const context = await setup(page, run); conversationId = context.conversationId;
      const created = await ask(page, 'Which recent news affects my largest holding?');
      await expect(page.getByRole('article', { name: 'Answer in progress' })).toContainText(LARGEST);
      const cancelled = page.waitForResponse(r => r.url().endsWith(`/api/runs/${created.run.id}/cancel`));
      await page.getByRole('button', { name: 'Cancel answer' }).click();
      expect((await cancelled).status()).toBe(202);
      await expect(page.getByText('Assistant · Cancelled', { exact: true })).toBeVisible();
      await expect(page.getByText('You cancelled this answer before it finished.', { exact: false })).toHaveCount(1);
      await expect(page.getByRole('article', { name: 'Answer in progress' })).toHaveCount(0);
      await expect(page.getByLabel('Ask about your portfolio')).toBeEditable();
      expect(await context.db.agentRun.findUnique({ where: { id: created.run.id }, select: { status: true, cancelRequestedAt: true } })).toMatchObject({ status: 'cancelled', cancelRequestedAt: expect.any(Date) });
      expect(await context.db.chatMessage.findUnique({ where: { id: created.run.assistantMessageId }, select: { status: true } })).toEqual({ status: 'cancelled' });
      await page.screenshot({ path: 'test-results/streamed-chat-cancelled.png', fullPage: true });
    } finally { await cleanup(run, conversationId); }
  });

  test('reloading mid-answer does not cancel it; the outcome is recovered after reconnection', async ({ page }) => {
    test.setTimeout(60000);
    const run = `chat-reload-${crypto.randomUUID().slice(0, 8)}`;
    let conversationId = '';
    try {
      const context = await setup(page, run); conversationId = context.conversationId;
      const created = await ask(page, 'Which recent news affects my largest holding?');
      await expect(page.getByRole('article', { name: 'Answer in progress' })).toBeVisible();
      await page.reload(); // closes the EventSource and every request of the old page
      expect(await context.db.agentRun.findUnique({ where: { id: created.run.id }, select: { status: true } })).toEqual({ status: 'running' });
      await page.getByLabel('Conversation', { exact: true }).selectOption(conversationId);
      await expect(page.getByText('Assistant · MOCK', { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(page.getByLabel('Conversation messages').getByText(LARGEST, { exact: false })).toHaveCount(1);
      expect(await context.db.agentRun.findUnique({ where: { id: created.run.id }, select: { status: true, cancelRequestedAt: true } })).toEqual({ status: 'completed', cancelRequestedAt: null });
    } finally { await cleanup(run, conversationId); }
  });

  test('a follow-up continues the same assistant session and says so', async ({ page }) => {
    test.setTimeout(90000);
    const run = `chat-follow-${crypto.randomUUID().slice(0, 8)}`;
    let conversationId = '';
    try {
      const context = await setup(page, run); conversationId = context.conversationId;
      await ask(page, 'Which recent news affects my largest holding?');
      const messages = page.getByLabel('Conversation messages');
      await expect(messages.getByText('New assistant session.', { exact: true })).toBeVisible({ timeout: 20000 });
      // The composer now asks for a follow-up and offers suggestions based on the cited sources.
      await page.getByRole('group', { name: 'Suggested follow-up questions' }).getByRole('button', { name: 'Tell me more about the first cited article' }).click();
      await expect(page.getByLabel('Ask a follow-up in this conversation')).toHaveValue('Tell me more about the first cited article');
      const created = page.waitForResponse(r => /\/runs$/.test(r.url()) && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const follow = await (await created).json() as { run: { id: string; assistantMessageId: string } };
      const answer = messages.locator(`[data-message-id="${follow.run.assistantMessageId}"]`);
      await expect(answer).toContainText('Continued in the same assistant session.', { timeout: 20000 });
      await expect(answer).toContainText('remembered by this session');
      await expect(answer.getByRole('link', { name: `${run}-news`, exact: true }).first()).toHaveAttribute('href', `https://example.invalid/${run}`);
      const binding = await context.db.conversationSession.findUnique({ where: { conversationId } });
      expect(binding).toMatchObject({ generation: 2, lastRunId: follow.run.id });
    } finally { await cleanup(run, conversationId); }
  });

  test('Analyze news shows a validated structured analysis, and a new conversation starts fresh', async ({ page }) => {
    test.setTimeout(90000);
    const run = `chat-analysis-${crypto.randomUUID().slice(0, 8)}`;
    let conversationId = '';
    try {
      const context = await setup(page, run); conversationId = context.conversationId;
      await page.getByLabel('Ask about your portfolio').fill('Analyze recent news for this portfolio');
      const created = page.waitForResponse(r => /\/runs$/.test(r.url()) && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Analyze news', exact: true }).click();
      const response = await created;
      expect(JSON.parse(response.request().postData()!)).toMatchObject({ kind: 'news_analysis' });
      const started = await response.json() as { run: { assistantMessageId: string; kind: string } };
      expect(started.run.kind).toBe('news_analysis');
      const analysis = page.getByRole('region', { name: 'Structured news analysis' });
      await expect(analysis).toBeVisible({ timeout: 20000 });
      for (const heading of ['Facts', 'Events', 'Affected securities', 'Interpretation', 'Uncertainties']) await expect(analysis.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(analysis.getByRole('link', { name: `${run}-news`, exact: true }).first()).toHaveAttribute('href', `https://example.invalid/${run}`);
      await expect(analysis).toContainText('held');
      await expect(page.getByText('You · Analyze news')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: 'test-results/structured-analysis.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      // A new conversation with the same scope has no session and no history.
      const fresh = page.waitForResponse(r => r.url().endsWith('/api/conversations') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Start a new conversation with the same scope' }).click();
      const next = (await (await fresh).json()).conversation as { id: string; portfolioId: string };
      expect(next.portfolioId).toBe(run);
      await expect(page.getByLabel('Conversation', { exact: true })).toHaveValue(next.id);
      await expect(page.getByLabel('Ask about your portfolio')).toBeEditable();
      expect(await context.db.conversationSession.findUnique({ where: { conversationId: next.id } })).toBeNull();
    } finally { await cleanup(run, conversationId); }
  });
});
