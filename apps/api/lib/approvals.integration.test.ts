import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { getDatabase, closeConnections, approvalService, authenticateOwner, chatService, approvalHash } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { POST as signIn } from '../app/api/auth/[...all]/route';
import { POST as approve } from '../app/api/approvals/[approvalId]/approve/route';
import { POST as reject } from '../app/api/approvals/[approvalId]/reject/route';
import { requireAuthorization } from './authorization';
import { startChatRun, cancelChatRun, reconcileStaleRuns } from './testing/worker-harness';
import { testChat, testApprovals } from './testing/worker-harness';
import { LocalRunCoordinator } from './testing/local-coordinator';
const databaseUrl = process.env.APPROVAL_TEST_DATABASE_URL;
const origin = 'http://localhost:5173';
const request = (path: string, cookie = '', body?: unknown, from = origin) => new Request(`${origin}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, origin: from, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const params = (approvalId: string) => ({ params: Promise.resolve({ approvalId }) });
const prefix = 'm25-' + randomUUID().slice(0,8);
describe.skipIf(!databaseUrl)('durable approvals against PostgreSQL', () => {
 let db: Awaited<ReturnType<typeof getDatabase>>, alice = '', bob = '';
 let auth: Awaited<ReturnType<typeof requireAuthorization>>, other: Awaited<ReturnType<typeof requireAuthorization>>;
 const conversations: string[] = [], securities: string[] = [], rules: string[] = [];
 beforeAll(async () => {
  const url = new URL(databaseUrl!);
  if (url.hostname !== '127.0.0.1' || !['/portfolio_m25_verify','/portfolio_m27_verify'].includes(url.pathname)) throw new Error('Dedicated local portfolio_m25_verify DB required.');
  vi.stubEnv('DATABASE_URL', databaseUrl!); vi.stubEnv('NODE_ENV','development'); vi.stubEnv('DATA_MODE','mock'); vi.stubEnv('AGENT_MODE','mock'); vi.stubEnv('AGENT_MOCK_STREAM_DELAY_MS','0');
  vi.stubEnv('AGENT_DAILY_BUDGET_USD','100'); vi.stubEnv('DEMO_AUTH_ENABLED','true'); vi.stubEnv('AUTH_BASE_URL',origin); vi.stubEnv('AUTH_SECRET','local-approval-verification-secret-1234567890');
  db = await getDatabase(databaseUrl!); await seedDemo(db);
  for (const account of ['alice','bob']) {
   const response = await signIn(request('auth/demo-sign-in','',{ account }));
   expect(response.status).toBe(200);
   const cookie = response.headers.getSetCookie().find(c => c.startsWith('better-auth.session_token='))!.split(';')[0]!;
   if (account === 'alice') alice = cookie; else bob = cookie;
  }
  auth = await requireAuthorization(request('conversations',alice)); other = await requireAuthorization(request('conversations',bob));
  auth.chat = testChat(db, auth.chat); auth.approvals = testApprovals(db, auth.approvals);
  other.chat = testChat(db, other.chat); other.approvals = testApprovals(db, other.approvals);
 });
 afterAll(async () => {
  if (db) {
   await db.conversation.deleteMany({ where: { id: { in: conversations } } });
   await db.alertRule.deleteMany({ where: { id: { in: rules } } });
   await db.watchlistEntry.deleteMany({ where: { securityId: { in: securities } } });
   await db.security.deleteMany({ where: { id: { in: securities } } });
   await db.outboxEvent.deleteMany({ where: { OR: [{ entityId: { in: rules } }, { payload: { path: ['securityId'], string_starts_with: prefix } }] } });
  }
  vi.unstubAllEnvs(); await closeConnections();
 });
 async function fixture() {
  const id = prefix + '-' + randomUUID().slice(0,8), symbol = 'M25' + randomUUID().slice(0,8).toUpperCase();
  await db.security.create({ data: { id, symbol, exchangeMic: 'XNAS', name: 'Approval fixture' } }); securities.push(id);
  const c = await auth.chat.create({}); conversations.push(c.id);
  const started = await auth.chat.startRun(c.id,{ runId: randomUUID(), assistantMessageId: randomUUID(), content:'Propose a change', budget: { reserveUsd: '0.2', dailyUsd: '100' } });
  return { id, change: { actionType: 'watchlist.add' as const, arguments: { symbol, exchangeMic:'XNAS' } }, run: started.run };
 }
 it('persists validated exact arguments and hash without writing, rejects unknown keys', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  expect(a.arguments).toEqual(f.change.arguments); expect(a.argumentHash).toBe(approvalHash(f.change));
  expect((await auth.chat.getRun(f.run.id)).status).toBe('waiting_for_approval');
  expect(await db.watchlistEntry.count({ where: { securityId:f.id } })).toBe(0);
  await expect(auth.approvals.propose(f.run.id,{ ...f.change, ownerId:'demo-bob' })).rejects.toThrow();
  await expect(auth.approvals.consume(a.id,f.run.id,f.change)).rejects.toMatchObject({ status:409 });
 });
 it('approve double-click and concurrent consume produce one mutation and one outbox event', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  await Promise.all([1,2].map(() => auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash })));
  const receipts = await Promise.all([1,2].map(() => auth.approvals.consume(a.id,f.run.id,f.change)));
  expect(receipts[0]).toEqual(receipts[1]); expect(receipts[0]!.mutationId).toBe(a.mutationId);
  expect(await db.watchlistEntry.count({ where: { securityId:f.id } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { entityId:a.mutationId } })).toBe(1);
  expect((await auth.approvals.get(a.id)).status).toBe('consumed');
 });
 it('reject is durable, idempotent and prevents consumption', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  await auth.approvals.decide(a.id,'rejected',{ argumentHash:a.argumentHash });
  await auth.approvals.decide(a.id,'rejected',{ argumentHash:a.argumentHash });
  await expect(auth.approvals.consume(a.id,f.run.id,f.change)).rejects.toMatchObject({ status:409 });
 });
 it('expired pending and approved records cannot be used', async () => {
  for (const grant of [false,true]) {
   const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
   if (grant) await auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash });
   await db.approvalRequest.update({ where:{ id:a.id }, data:{ expiresAt:new Date(0) } });
   await expect(auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash })).rejects.toMatchObject({ status:409 });
   expect((await auth.approvals.get(a.id)).status).toBe('expired');
   await expect(auth.approvals.consume(a.id,f.run.id,f.change)).rejects.toMatchObject({ status:409 });
  }
 });
 it('changed arguments and another run need new approval; canonical key order is stable', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  await auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash });
  await expect(auth.approvals.consume(a.id,f.run.id,{ ...f.change, arguments:{ ...f.change.arguments, exchangeMic:'XNYS' } })).rejects.toMatchObject({ status:409 });
  const g = await fixture(); await expect(auth.approvals.consume(a.id,g.run.id,f.change)).rejects.toMatchObject({ status:404 });
  expect(approvalHash({ arguments:{ exchangeMic:'XNAS',symbol:f.change.arguments.symbol },actionType:'watchlist.add' })).toBe(a.argumentHash);
  expect((await auth.approvals.propose(f.run.id,g.change)).id).not.toBe(a.id);
 });
 it('foreign approval IDs, anonymous and forged origins are rejected by real endpoints', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  for (const route of [approve,reject]) {
   expect((await route(request(`approvals/${a.id}`,bob,{ argumentHash:a.argumentHash }),params(a.id))).status).toBe(404);
   expect((await route(request(`approvals/${a.id}`,'',{ argumentHash:a.argumentHash }),params(a.id))).status).toBe(401);
   expect((await route(request(`approvals/${a.id}`,alice,{ argumentHash:a.argumentHash },'https://evil.invalid'),params(a.id))).status).toBe(403);
  }
  await expect(other.approvals.consume(a.id,f.run.id,f.change)).rejects.toMatchObject({ status:404 });
 });
 it('watchlist state changes invalidate a pending approval', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  await auth.watchlist.add({ securityId:f.id });
  await expect(auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash })).rejects.toMatchObject({ status:409 });
  expect((await auth.approvals.get(a.id)).status).toBe('invalidated');
 });
 it('alert replacement checks revision, ownership and current state again at use', async () => {
  const f = await fixture(); const rule = await auth.alerts.create({ name:'Before' }); rules.push(rule.id);
  const { id, revision, createdAt, ...before } = rule;
  const change = { actionType:'alert.update', arguments:{ ruleId:id, expectedRevision:revision, rule:{ ...before,name:'After',cooldownSeconds:90 } } };
  const a = await auth.approvals.propose(f.run.id,change);
  await auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash });
  await auth.approvals.consume(a.id,f.run.id,change); await auth.approvals.consume(a.id,f.run.id,change);
  expect((await auth.alerts.rules()).find(r => r.id === id)).toMatchObject({ name:'After',revision:2,cooldownSeconds:90 });
  const next = { ...change,arguments:{ ...change.arguments,expectedRevision:2 } };
  const b = await auth.approvals.propose(f.run.id,next);
  await auth.approvals.decide(b.id,'approved',{ argumentHash:b.argumentHash });
  await auth.alerts.edit(id,{ ...before,name:'Manual update' });
  await expect(auth.approvals.consume(b.id,f.run.id,next)).rejects.toMatchObject({ status:409 });
  const foreign = await other.chat.create({}); conversations.push(foreign.id);
  const r = await other.chat.startRun(foreign.id,{ runId:randomUUID(),assistantMessageId:randomUUID(),content:'change' });
  await expect(other.approvals.propose(r.run.id,next)).rejects.toMatchObject({ status:404 });
 });
 it('cancellation of a waiting or approved run prevents any later write', async () => {
  for (const grant of [false,true]) {
   const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
   if (grant) await auth.approvals.decide(a.id,'approved',{ argumentHash:a.argumentHash });
   const run = await cancelChatRun({ ownerId:auth.user.id,chat:auth.chat,runId:f.run.id,events:null });
   expect(run.cancelRequested).toBe(true);
   await auth.chat.finishRun(f.run.id, { status: 'cancelled', failureCode: null, content: 'Cancelled fixture', mode: null, instructionVersion: null, sources: [] }); expect((await auth.approvals.get(a.id)).status).toBe('cancelled');
   await expect(auth.approvals.consume(a.id,f.run.id,f.change)).rejects.toMatchObject({ status:409 });
   expect(await db.watchlistEntry.count({ where:{ securityId:f.id } })).toBe(0);
  }
 });
 it('lost waiting callback fails safely; explicit new run requires a new approval', async () => {
  const f = await fixture(); const a = await auth.approvals.propose(f.run.id,f.change);
  await db.agentRun.update({ where: { id: f.run.id }, data: { executionStartedAt: new Date(0), leaseUntil: new Date(0) } });
  const response = await approve(request(`approvals/${a.id}/approve`,alice,{ argumentHash:a.argumentHash }),params(a.id));
  await reconcileStaleRuns({ ownerId: auth.user.id, chat: auth.chat });
  expect(response.status).toBe(409); expect((await auth.chat.getRun(f.run.id)).status).toBe('failed');
  expect((await auth.approvals.get(a.id)).status).toBe('invalidated');
  const next = await auth.chat.startRun(f.run.conversationId,{ runId:randomUUID(),assistantMessageId:randomUUID(),content:'Confirm new proposal', budget: { reserveUsd: '0.2', dailyUsd: '100' } });
  expect((await auth.approvals.propose(next.run.id,f.change)).id).not.toBe(a.id);
 });
 it('mock run waits then applies only after explicit approval, and rejects/cancels without hanging', async () => {
  for (const decision of ['approve','reject','cancel'] as const) {
   const f = await fixture(); // release the manually created run first
   await auth.chat.finishRun(f.run.id,{ status:'failed',failureCode:'fixture',content:'fixture',mode:null,instructionVersion:null,sources:[] });
   const started = await startChatRun({ ownerId:auth.user.id,chat:auth.chat,approvals:auth.approvals,tools:auth.agentTools,conversationId:f.run.conversationId,body:{ content:`Add ${f.change.arguments.symbol} to my watchlist` },events:null,replayCursor:async () => null });
   let a: Awaited<ReturnType<typeof auth.approvals.get>> | undefined;
   for (let n=0;n<60&&!a;n++) { a=(await auth.approvals.list(started.run.id))[0]; if(!a) await new Promise(r=>setTimeout(r,20)); }
   expect(a).toBeDefined(); expect(await db.watchlistEntry.count({where:{securityId:f.id}})).toBe(0);
   if (decision === 'cancel') await cancelChatRun({ ownerId:auth.user.id,chat:auth.chat,runId:started.run.id,events:null });
   else expect((await (decision === 'approve' ? approve : reject)(request(`approvals/${a!.id}/${decision}`,alice,{argumentHash:a!.argumentHash}),params(a!.id))).status).toBe(200);
   await started.done;
   expect((await auth.chat.getRun(started.run.id)).status).toBe(decision === 'approve' ? 'completed' : decision === 'cancel' ? 'cancelled' : 'failed');
   expect(await db.watchlistEntry.count({where:{securityId:f.id}})).toBe(decision === 'approve' ? 1 : 0);
  }
 });
 it('executing cancellation wins over a dependency that returns success after abort', async () => {
  const f=await fixture();
  await auth.chat.finishRun(f.run.id,{status:'failed',failureCode:'fixture',content:'fixture',mode:null,instructionVersion:null,sources:[]});
  const coordinator=new LocalRunCoordinator();
  let entered!:()=>void, release!:()=>void;
  const executing=new Promise<void>(r=>{entered=r;});const hold=new Promise<void>(r=>{release=r;});
  const started=await startChatRun({ownerId:auth.user.id,chat:auth.chat,approvals:auth.approvals,tools:auth.agentTools,conversationId:f.run.conversationId,body:{content:'Execute a research answer'},coordinator,events:null,replayCursor:async()=>null,
   agentFactory:()=>({sessions:async()=>({hostKey:'fixture',modelKey:'fixture',isAvailable:async()=>false}),stream:async()=>{entered();await hold;return {mode:'mock',text:'Late answer',sessionId:null};}})});
  await executing;await cancelChatRun({ownerId:auth.user.id,chat:auth.chat,runId:started.run.id,coordinator,events:null});release();await started.done;
  expect((await auth.chat.getRun(started.run.id)).status).toBe('cancelled');
  expect((await auth.approvals.list(started.run.id))).toEqual([]);
  expect((await auth.chat.messages(f.run.conversationId,{})).messages.at(-1)?.status).toBe('cancelled');
 });
 it('cancel/consume race is serialized and a cancelled pending write never executes later', async () => {
  const f=await fixture();const a=await auth.approvals.propose(f.run.id,f.change);
  await auth.approvals.decide(a.id,'approved',{argumentHash:a.argumentHash});
  const [cancelled, used]=await Promise.allSettled([auth.chat.requestCancel(f.run.id),auth.approvals.consume(a.id,f.run.id,f.change)]);
  expect(cancelled.status).toBe('fulfilled');
  const count=await db.watchlistEntry.count({where:{securityId:f.id}});
  expect(count).toBe(used.status === 'fulfilled' ? 1 : 0);
  await expect(auth.approvals.consume(a.id,f.run.id,{...f.change,arguments:{...f.change.arguments,symbol:'CHANGED'}})).rejects.toMatchObject({status:409});
 });
});
