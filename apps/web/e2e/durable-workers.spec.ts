import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { getDatabase, closeConnections } from '@portfolio-pilot/db';
const url = process.env.AGENT_JOBS_TEST_DATABASE_URL;
test('queued submission, durable draft after reload, one final answer, and remote cancellation', async ({ page }) => {
 test.skip(!url, 'Run the milestone 27 browser verifier against its dedicated local database.');
 test.setTimeout(60000);
 const parsed = new URL(url!);
 if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/portfolio_m27_verify') throw new Error('Use portfolio_m27_verify.');
 const db = await getDatabase(url!);
 const securityId = 'm27-ui-' + crypto.randomUUID(), symbol = 'U27' + crypto.randomUUID().slice(0,6).toUpperCase();
 await db.security.create({ data: { id: securityId, symbol, exchangeMic: 'XNAS', name: 'Worker browser fixture' } });
 let conversationId = '';
 let worker: ReturnType<typeof spawn> | undefined;
 try {
  await page.goto('/assistant'); await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
  const created = page.waitForResponse(r => r.url().endsWith('/api/conversations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  conversationId = (await (await created).json()).conversation.id;
  async function send(content: string) {
   await page.locator('#chat-question').fill(content);
   const response = page.waitForResponse(r => r.url().endsWith('/runs') && r.request().method() === 'POST');
   await page.getByRole('button', { name: 'Send', exact: true }).click();
   const row = await response; expect(row.status()).toBe(202); return (await row.json()).run;
  }
  const run = await send('Explain my holdings and recent news');
  expect(run.status).toBe('queued');
  await expect(page.getByRole('button', { name: 'Cancel answer' })).toBeVisible();
  worker = spawn(process.execPath, [fileURLToPath(new URL('../../worker/dist/index.js', import.meta.url))], { env: { ...process.env, DATABASE_URL: url!, DATA_MODE: 'mock', AGENT_MODE: 'mock', WORKER_ROLE: 'agent', AGENT_MOCK_STREAM_DELAY_MS: '1000', AGENT_DAILY_BUDGET_USD: '100' }, windowsHide: true, stdio: 'ignore' });
  await expect(page.locator('.chat-draft-text').first()).toBeVisible({ timeout: 15000 });
  const chunks = await db.agentRunChunk.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } });
  const visible = chunks.map(c => c.event as { type: string; payload: { text?: string } }).find(c => c.type === 'agent.text.delta')!.payload.text!;
  await page.reload();
  const answer = page.locator(`[data-message-id="${run.assistantMessageId}"]`);
  await expect(answer).toContainText(visible, { timeout: 15000 });
  await expect(answer).toContainText('Mock run: no model charges.', { timeout: 30000 });
  await expect(answer).toHaveCount(1);
  expect((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).attempt).toBe(1);
  const cancelled = await send(`Add ${symbol} to my watchlist`);
  await expect(page.getByRole('button', { name: 'Approve change' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Cancel answer' }).click();
  await expect(page.locator(`[data-message-id="${cancelled.assistantMessageId}"]`)).toContainText('cancelled', { timeout: 15000 });
  expect(await db.watchlistEntry.count({ where: { securityId } })).toBe(0);
 } finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, 'exit'); worker.kill(); await exited; }
  if (conversationId) await db.conversation.deleteMany({ where: { id: conversationId } });
  await db.watchlistEntry.deleteMany({ where: { securityId } }); await db.security.delete({ where: { id: securityId } });
  await closeConnections();
 }
});
