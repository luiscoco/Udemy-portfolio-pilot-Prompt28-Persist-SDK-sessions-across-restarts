import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentJobs, appendRunProgress, authenticateOwner, approvalService, buildEvent, chatService, closeConnections, getDatabase, ownerForAgentRun, uuidV5, type RunFence, type RunOutcome } from '@portfolio-pilot/db';
const url = process.env.AGENT_JOBS_TEST_DATABASE_URL;
const result: RunOutcome = { status: 'completed', failureCode: null, content: 'Saved answer', mode: 'mock', instructionVersion: null, sources: [], usage: { accounting: 'mock', estimatedCostUsd: '0.000000', aggregateTokens: 0, turns: 0, resultCount: 0 } };
describe.skipIf(!url)('durable PostgreSQL agent attempts', () => {
 let db: Awaited<ReturnType<typeof getDatabase>>;
 let jobs: ReturnType<typeof agentJobs>;
 const users: string[] = [], children: ChildProcess[] = [];
 beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/portfolio_m27_verify') throw new Error('Use the dedicated loopback portfolio_m27_verify database.');
  db = await getDatabase(url!); jobs = agentJobs(db);
 });
 afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill();
  if (db) await db.user.deleteMany({ where: { id: { in: users } } });
  await closeConnections();
 });
 async function fixture(content = 'Explain my holdings') {
  const id = 'm27-' + randomUUID(); users.push(id);
  await db.user.create({ data: { id, name: 'Worker test', email: `${id}@example.invalid` } });
  await db.session.create({ data: { id, userId: id, token: id, expiresAt: new Date(Date.now() + 600000) } });
  const owner = await authenticateOwner(db, id), chat = chatService(db, owner);
  const conversation = await chat.create({});
  const started = await chat.startRun(conversation.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content });
  return { id, owner, chat, conversation, ...started };
 }
 async function worker(fence: RunFence) { return chatService(db, await ownerForAgentRun(db, fence), fence); }
 async function expire(fence: RunFence) {
  await db.agentRun.update({ where: { id: fence.runId }, data: { leaseUntil: new Date(0) } });
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: fence.runId } });
  await db.conversation.update({ where: { id: run.conversationId }, data: { leaseUntil: new Date(0) } });
 }
 it('submits queued jobs, serializes concurrent admission and grants exactly one competing worker an attempt', async () => {
  const f = await fixture(); expect(f.run.status).toBe('queued');
  await expect(f.chat.startRun(f.conversation.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content: 'collision' })).rejects.toMatchObject({ status: 409 });
  const claims = await Promise.all([jobs.claim('replica-a'), jobs.claim('replica-b')]);
  const fence = claims.find(Boolean)!; expect(claims.filter(Boolean)).toHaveLength(1);
  expect(fence).toMatchObject({ runId: f.run.id, attempt: 1 });
  const row = await db.agentRun.findUniqueOrThrow({ where: { id: f.run.id } });
  expect(row.heartbeatAt).not.toBeNull(); expect(row.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
  await (await worker(fence)).finishRun(f.run.id, result);
 });
 it('only unstarted attempts retry; stale completion, heartbeat, session and progress cannot overwrite the new attempt', async () => {
  const f = await fixture(), first = (await jobs.claim('old'))!;
  const stale = await worker(first); await expire(first); expect(await jobs.recover()).toBe(1);
  const second = (await jobs.claim('new'))!; expect(second.attempt).toBe(2);
  await expect(stale.finishRun(f.run.id, result)).rejects.toMatchObject({ status: 409 });
  await expect(jobs.heartbeat(first)).rejects.toMatchObject({ status: 409 });
  await expect(stale.bindSession(f.conversation.id, null, { sdkSessionId: randomUUID(), agentMode: 'mock', modelKey: 'mock:test', hostKey: 'test', instructionVersion: 'test', runId: f.run.id })).rejects.toMatchObject({ status: 409 });
  const event = buildEvent({ type: 'agent.run.started', audience: { kind: 'user', userId: f.id }, entityType: 'agent_run', entityId: f.run.id, portfolioId: null, payload: { conversationId: f.conversation.id, messageId: f.run.assistantMessageId, sequence: 0, userMessageId: f.userMessage.id } });
  await expect(appendRunProgress(db, first, event)).rejects.toMatchObject({ status: 409 });
  await (await worker(second)).finishRun(f.run.id, result);
 });
 it('persists sequenced visible batches and outbox atomically; retries cannot duplicate chunks or final messages', async () => {
  const f = await fixture(), fence = (await jobs.claim('journal'))!; await jobs.heartbeat(fence, true);
  const event = buildEvent({ id: uuidV5(`agent-run:${f.run.id}:0`), type: 'agent.text.delta', audience: { kind: 'user', userId: f.id }, entityType: 'agent_run', entityId: f.run.id, portfolioId: null,
    payload: { conversationId: f.conversation.id, messageId: f.run.assistantMessageId, sequence: 0, blockId: 'answer.0', offset: 0, text: 'Visible partial' } });
  await appendRunProgress(db, fence, event); await expect(appendRunProgress(db, fence, event)).rejects.toThrow();
  expect(await f.chat.progress(f.run.id)).toHaveLength(1);
  expect(await db.outboxEvent.count({ where: { id: event.id } })).toBe(1);
  const chat = await worker(fence);
  const finished = await Promise.all([chat.finishRun(f.run.id, result), chat.finishRun(f.run.id, result)]);
  expect(finished.filter(Boolean)).toHaveLength(1);
  expect(await db.chatMessage.count({ where: { id: f.run.assistantMessageId } })).toBe(1);
  expect((await f.chat.progress(f.run.id)).map(e => (e as { payload: { sequence: number } }).payload.sequence)).toEqual([0,1,2]);
  expect(await db.outboxEvent.count({ where: { entityId: f.run.id } })).toBe(3);
 });
 it('bounds persisted progress and rolls back rejected batches while preserving a terminal outcome', async () => {
  const f = await fixture(), fence = (await jobs.claim('bounded-progress'))!;
  let accepted = 0;
  for (let n=0;n<40;n++) {
   const event = buildEvent({ type: 'agent.text.delta', audience: { kind: 'user', userId: f.id }, entityType: 'agent_run', entityId: f.run.id, portfolioId: null,
    payload: { conversationId: f.conversation.id, messageId: f.run.assistantMessageId, sequence: n, blockId: 'block-' + n, offset: 0, text: 'x'.repeat(8192) } });
   try { await appendRunProgress(db, fence, event); accepted++; } catch { break; }
  }
  expect(accepted).toBeGreaterThan(0); expect(accepted).toBeLessThan(40);
  const row = await db.agentRun.findUniqueOrThrow({ where: { id: f.run.id } });
  expect(row.progressBytes).toBeLessThanOrEqual(262144);
  expect(await db.agentRunChunk.count({ where: { runId: f.run.id } })).toBe(accepted);
  expect(await db.outboxEvent.count({ where: { entityId: f.run.id } })).toBe(accepted);
  await (await worker(fence)).finishRun(f.run.id, { ...result, status: 'failed', failureCode: 'progress_failure' });
  expect(await f.chat.progress(f.run.id)).toHaveLength(accepted + 2);
 }, 20000);
 it('crashed partially executed work fails visibly without replay and retains uncertain budget', async () => {
  const f = await fixture(), fence = (await jobs.claim('crashed'))!; await jobs.heartbeat(fence, true); await expire(fence);
  expect(await jobs.recover()).toBe(1); expect(await jobs.claim('replacement')).toBeNull();
  expect(await f.chat.getRun(f.run.id)).toMatchObject({ status: 'failed', failureCode: 'interrupted', usage: { accounting: 'conservative' } });
  expect((await f.chat.messages(f.conversation.id, {})).messages.at(-1)!.content).toContain('not automatically replayed');
  const budget = await db.dailyAgentBudget.findFirstOrThrow({ where: { ownerId: f.id } });
  expect(budget.reservedUsd.toFixed(6)).toBe('0.000000'); expect(budget.chargedUsd.toFixed(6)).toBe('0.200000');
  expect(await jobs.recover()).toBe(0);
 });
 it('queued cancellation finishes without a worker or charge; inspection never cancels a healthy remote run', async () => {
  const f = await fixture(); expect((await f.chat.requestCancel(f.run.id)).status).toBe('cancelled');
  expect((await f.chat.getRun(f.run.id)).usage?.accounting).toBe('not_started');
  expect(await jobs.claim('none')).toBeNull();
  expect((await db.dailyAgentBudget.findFirstOrThrow({ where: { ownerId: f.id } })).chargedUsd.toFixed(6)).toBe('0.000000');
  const g = await fixture(), fence = (await jobs.claim('remote'))!; await jobs.heartbeat(fence, true);
  await db.agentRun.update({ where: { id: g.run.id }, data: { createdAt: new Date(0) } });
  expect((await g.chat.getRun(g.run.id)).status).toBe('running'); expect(await jobs.recover()).toBe(0);
  await g.chat.requestCancel(g.run.id); expect(await jobs.heartbeat(fence)).toBe('cancelled');
  await (await worker(fence)).finishRun(g.run.id, result); expect((await g.chat.getRun(g.run.id)).status).toBe('cancelled');
 });
 it('approval consumption is idempotent and fenced; waiting leases remain alive and crash recovery invalidates grants', async () => {
  const f = await fixture(), fence = (await jobs.claim('approval-worker'))!; await jobs.heartbeat(fence, true);
  const security = await db.security.create({ data: { symbol: 'T' + randomUUID().slice(0,8).toUpperCase(), exchangeMic: 'XNAS', name: 'Test' } });
  try {
   const change = { actionType: 'watchlist.add', arguments: { symbol: security.symbol, exchangeMic: 'XNAS' } };
   const approvals = approvalService(db, f.owner, () => new Date(), fence);
   const proposal = await approvals.propose(f.run.id, change);
   expect((await f.chat.getRun(f.run.id)).status).toBe('waiting_for_approval');
   await approvalService(db, f.owner).decide(proposal.id, 'approved', { argumentHash: proposal.argumentHash });
   const receipts = await Promise.all([approvals.consume(proposal.id, f.run.id, change), approvals.consume(proposal.id, f.run.id, change)]);
   expect(receipts[0]).toEqual(receipts[1]); expect(await db.watchlistEntry.count({ where: { ownerId: f.id } })).toBe(1);
   const next = await approvals.propose(f.run.id, { actionType: 'watchlist.add', arguments: { symbol: security.symbol, exchangeMic: 'XNYS' } }).catch(() => null);
   expect(next).toBeNull();
   await expire(fence);
   await expect(approvals.consume(proposal.id, f.run.id, change)).rejects.toMatchObject({ status: 409 });
   await jobs.recover(); expect((await approvals.get(proposal.id)).status).toBe('consumed');
   expect(await db.watchlistEntry.count({ where: { ownerId: f.id } })).toBe(1);
  } finally { await db.watchlistEntry.deleteMany({ where: { securityId: security.id } }); await db.security.delete({ where: { id: security.id } }); }
 });
 function launch() {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], { env: { ...process.env, DATABASE_URL: url!, DATA_MODE: 'mock', AGENT_MODE: 'mock', WORKER_ROLE: 'agent', WORKER_ONCE: 'true', AGENT_MOCK_STREAM_DELAY_MS: '100' }, stdio: ['ignore','pipe','pipe'] });
  children.push(child); return child;
 }
 it('two actual worker processes complete a durable job once after the submitting database client disconnects', async () => {
  const f = await fixture();
  // No session cookie or API memory is needed by the workers.
  await closeConnections();
  const a = launch(), b = launch();
  const exits = await Promise.all([a,b].map(child => new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); })));
  expect(exits).toEqual([0,0]);
  db = await getDatabase(url!); jobs = agentJobs(db);
  const row = await db.agentRun.findUniqueOrThrow({ where: { id: f.run.id } });
  expect(row).toMatchObject({ status: 'completed', attempt: 1 });
  expect(await db.chatMessage.count({ where: { id: row.assistantMessageId } })).toBe(1);
  expect(await db.agentRunChunk.count({ where: { runId: row.id } })).toBeGreaterThan(3);
 }, 30000);
});
