import { expect, test } from '@playwright/test';
import { closeConnections, getDatabase } from '@portfolio-pilot/db';

const url = process.env.BUDGET_E2E_DATABASE_URL;
test.describe('assistant limits and context reset', () => {
  test.skip(!url, 'Set BUDGET_E2E_DATABASE_URL and start mock API/Vite with the lesson 26 configuration.');
  test.afterAll(async () => { await closeConnections(); });
  test('shows preserved scope, context reset, timeout, cancellation and daily admission failure', async ({ page }) => {
    test.setTimeout(60000);
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/portfolio_m26_verify') throw new Error('Use dedicated loopback portfolio_m26_verify.');
    const db = await getDatabase(url!);
    const alice = await db.user.findUniqueOrThrow({ where: { id: 'demo-alice' } });
    const portfolio = await db.portfolio.findFirstOrThrow({ where: { ownerId: alice.id } });
    const securityId = 'm26-ui-' + crypto.randomUUID(), symbol = 'M26' + crypto.randomUUID().slice(0, 6).toUpperCase();
    await db.security.create({ data: { id: securityId, symbol, exchangeMic: 'XNAS', name: 'Budget UI fixture' } });
    let conversationId = '';
    const old = await db.dailyAgentBudget.findMany({ where: { ownerId: alice.id } });
    try {
      await page.goto('/assistant'); await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
      await expect(page.locator('#chat-scope')).toContainText(portfolio.name);
      await page.locator('#chat-scope').selectOption(portfolio.id);
      const created = page.waitForResponse(r => r.url().endsWith('/api/conversations') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'New conversation', exact: true }).click();
      const conversation = (await (await created).json()).conversation; conversationId = conversation.id;
      expect(conversation.portfolioId).toBe(portfolio.id);
      await expect(page.getByLabel('Conversation', { exact: true })).toHaveValue(conversationId);
      const send = async (content: string) => {
        await page.locator('#chat-question').fill(content);
        const response = page.waitForResponse(r => r.url().endsWith('/runs') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        const row = await response; expect(row.status()).toBe(202); return (await row.json()).run;
      };
      for (let turn = 0; turn < 2; turn++) {
        const run = await send('What do I own?');
        await expect(page.locator(`[data-message-id="${run.assistantMessageId}"]`)).toContainText('Mock run: no model charges.');
      }
      await expect(page.getByText(/configured context window was reset/)).toBeVisible();
      expect((await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).portfolioId).toBe(portfolio.id);
      const timed = await send(`Add ${symbol} to my watchlist`);
      await expect(page.locator(`[data-message-id="${timed.assistantMessageId}"]`)).toContainText('reached its time limit', { timeout: 15000 });
      expect((await db.agentRun.findUniqueOrThrow({ where: { id: timed.id } })).failureCode).toBe('timeout');
      const cancelled = await send(`Add ${symbol} to my watchlist`);
      await page.getByRole('button', { name: 'Cancel answer' }).click();
      await expect(page.locator(`[data-message-id="${cancelled.assistantMessageId}"]`)).toContainText('cancelled');
      expect(await db.watchlistEntry.count({ where: { securityId } })).toBe(0);
      const ledger = await db.dailyAgentBudget.findFirstOrThrow({ where: { ownerId: alice.id } });
      await db.dailyAgentBudget.update({ where: { ownerId_day: { ownerId: alice.id, day: ledger.day } }, data: { chargedUsd: '2' } });
      await page.locator('#chat-question').fill('Another answer');
      const rejected = page.waitForResponse(r => r.url().endsWith('/runs') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      expect((await rejected).status()).toBe(429);
      await expect(page.getByRole('alert')).toContainText('daily assistant budget');
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Cancel answer' })).toHaveCount(0);
    } finally {
      if (conversationId) await db.conversation.deleteMany({ where: { id: conversationId } });
      await db.security.deleteMany({ where: { id: securityId } });
      await db.dailyAgentBudget.deleteMany({ where: { ownerId: alice.id } });
      for (const row of old) await db.dailyAgentBudget.create({ data: row });
    }
  });
});
