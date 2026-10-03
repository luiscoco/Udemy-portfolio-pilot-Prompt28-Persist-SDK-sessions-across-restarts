import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDatabase, closeConnections } from '../packages/db/dist/index.js';
import { seedDemo } from '../packages/db/dist/seed.js';
const databaseUrl = process.env.AGENT_JOBS_TEST_DATABASE_URL;
const parsed = new URL(databaseUrl ?? '');
assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(parsed.pathname, '/portfolio_m27_verify');
const origin = 'http://127.0.0.1:5301';
const env = { ...process.env, NODE_ENV: 'development', DATA_MODE: 'mock', AGENT_MODE: 'mock', DATABASE_URL: databaseUrl,
 REDIS_URL: 'redis://127.0.0.1:6379', DEMO_AUTH_ENABLED: 'true', AUTH_BASE_URL: origin,
 AUTH_SECRET: 'milestone-27-local-verification-only-secret', AGENT_MOCK_STREAM_DELAY_MS: '1000', AGENT_DAILY_BUDGET_USD: '100' };
const db = await getDatabase(databaseUrl), children = [], conversations = [];
let cookie = '', api;
const cancelSecurityId = 'm27-cancel-' + randomUUID(), cancelSymbol = 'C27' + randomUUID().slice(0,6).toUpperCase();
const securityId = 'm27-http-' + randomUUID(), symbol = 'M27' + randomUUID().slice(0,6).toUpperCase();
function launch(args, extra = {}, cwd) {
 const child = spawn(process.execPath, args, { env: { ...env, ...extra }, cwd, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
 children.push(child); child.stdout.resume(); child.stderr.on('data', bytes => { const line = bytes.toString(); if (line.includes('API dependency operation failed')) process.stderr.write(line); }); return child;
}
async function stop(child) { if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
async function startApi() {
 api = launch([fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'start', '--hostname','127.0.0.1','--port','5301'], {}, fileURLToPath(new URL('../apps/api', import.meta.url)));
 for (let n=0;n<100;n++) {
  if (api.exitCode !== null) throw new Error('API startup failed');
  try { if ((await fetch(origin + '/api/health/live')).ok) return; } catch {}
  await sleep(100);
 }
 throw new Error('API not ready');
}
async function request(path, body, expected = 200, session = cookie) {
 const response = await fetch(origin + '/api/' + path, { headers: { cookie: session, origin, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { method:'POST', body:JSON.stringify(body) }) });
 assert.equal(response.status, expected, path); return response;
}
async function json(path, body, expected = 200) { return (await request(path, body, expected)).json(); }
async function waitRun(id, status) {
 for (let n=0;n<300;n++) {
  const run = await db.agentRun.findUniqueOrThrow({ where:{id} });
  if (status.includes(run.status)) return run;
  await sleep(100);
 }
 throw new Error('Run did not reach ' + status);
}
async function createRun(content) {
 const { conversation } = await json('conversations', { title:'Milestone 27 acceptance' }, 201); conversations.push(conversation.id);
 return (await json(`conversations/${conversation.id}/runs`, { content }, 202)).run;
}
try {
 await seedDemo(db);
 await db.security.create({ data:{ id:securityId, symbol, exchangeMic:'XNAS', name:'Restart fixture' } });
 await db.security.create({ data:{ id:cancelSecurityId, symbol:cancelSymbol, exchangeMic:'XNAS', name:'Cancellation fixture' } });
 await startApi();
 const signedIn = await request('auth/demo-sign-in',{account:'alice'});
 cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
 const run = await createRun('Explain my holdings'); assert.equal(run.status,'queued');
 const worker = launch([fileURLToPath(new URL('../apps/worker/dist/index.js', import.meta.url))], {WORKER_ROLE:'agent'});
 await waitRun(run.id,['running']);
 await stop(api); // agent process and PostgreSQL lease are independent of API lifetime
 await startApi();
 await waitRun(run.id,['completed']);
 assert.equal((await json(`runs/${run.id}`)).run.status,'completed');
 const chunks = (await json(`runs/${run.id}/chunks`)).events;
 assert.ok(chunks.some(e=>e.type==='agent.text.delta')); assert.equal(chunks.filter(e=>e.type==='agent.message.completed').length,1);
 assert.deepEqual(chunks.map(e=>e.sequence),chunks.map((_,i)=>i));
 await request(`runs/${run.id}/chunks`,undefined,401,'');
 const approvalRun = await createRun(`Add ${symbol} to my watchlist`);
 await waitRun(approvalRun.id,['waiting_for_approval']);
 await stop(api); await startApi();
 const approval = (await json(`runs/${approvalRun.id}/approvals`)).approvals[0];
 await json(`approvals/${approval.id}/approve`,{argumentHash:approval.argumentHash});
 await waitRun(approvalRun.id,['completed']);
 assert.equal(await db.watchlistEntry.count({where:{securityId}}),1);
 const cancelled = await createRun(`Add ${cancelSymbol} to my watchlist`);
 await waitRun(cancelled.id,['waiting_for_approval']);
 await json(`runs/${cancelled.id}/cancel`,{},202);
 await waitRun(cancelled.id,['cancelled']);
 assert.equal(await db.watchlistEntry.count({where:{securityId:cancelSecurityId}}),0);
 const crashed = await createRun(`Add ${cancelSymbol} to my watchlist`);
 await waitRun(crashed.id,['waiting_for_approval']);
 await stop(worker);
 // Fast-forward only this test job's expired lease after terminating its real process.
 await db.agentRun.update({where:{id:crashed.id},data:{leaseUntil:new Date(0)}});
 await db.conversation.update({where:{id:crashed.conversationId},data:{leaseUntil:new Date(0)}});
 const replacement = launch([fileURLToPath(new URL('../apps/worker/dist/index.js', import.meta.url))], {WORKER_ROLE:'agent'});
 await waitRun(crashed.id,['failed']);
 assert.equal((await json(`runs/${crashed.id}`)).run.failureCode,'interrupted');
 assert.equal((await json(`runs/${crashed.id}/approvals`)).approvals[0].status,'invalidated');
 assert.equal(await db.watchlistEntry.count({where:{securityId:cancelSecurityId}}),0);
 await stop(replacement);
 const outbox = launch([fileURLToPath(new URL('../apps/worker/dist/index.js', import.meta.url))], {WORKER_ROLE:'outbox',WORKER_ONCE:'true',OUTBOX_BATCH_SIZE:'500'});
 await once(outbox,'exit'); assert.equal(outbox.exitCode,0);
 const controller = new AbortController();
 const stream = await fetch(origin + '/api/events', { headers:{cookie}, signal:controller.signal }); assert.equal(stream.status,200);
 const reader = stream.body.getReader();
 const frame = await reader.read(); assert.equal(frame.done,false); assert.ok(frame.value.length); assert.ok(stream.headers.get('content-type').startsWith('text/event-stream'));
 assert.ok(await db.outboxEvent.count({where:{entityId:run.id,status:'PUBLISHED'}})>0);
 controller.abort(); await reader.cancel().catch(()=>{});
 assert.equal(await db.chatMessage.count({where:{id:run.assistantMessageId}}),1);
 console.log('PASS: actual Next.js API restart preserves worker execution, sequenced chunk recovery, approval after API restart, explicit cancellation, crashed-worker interruption, authenticated SSE, and exactly-once completion.');
 await stop(worker);
} finally {
 for (const child of children) await stop(child);
 await db.conversation.deleteMany({where:{id:{in:conversations}}});
 await db.watchlistEntry.deleteMany({where:{securityId}});
 await db.security.deleteMany({where:{id:{in:[securityId,cancelSecurityId]}}});
 await closeConnections();
}
