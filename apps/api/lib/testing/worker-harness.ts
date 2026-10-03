import { randomUUID } from 'node:crypto';
import type { PortfolioToolContext, StreamingAgentService } from '@portfolio-pilot/agent';
import { getDatabase, publishEvent, agentJobs, appendRunProgress, chatService, approvalService, ownerForAgentRun, type ChatService, type ApprovalService, type RunFence } from '@portfolio-pilot/db';
import { appEventSchema } from '@portfolio-pilot/contracts';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { executeRun } from '../../../worker/src/agent-execution';
import { RunEventPublisher } from '../../../worker/src/agent-run-events';
import { startChatRun as submit, cancelChatRun as cancel } from '../chat';
import type { RunEventTarget } from '../../../worker/src/agent-run-events';
export type AgentFactory = (tools: PortfolioToolContext) => StreamingAgentService;
export const cancelChatRun = (input: Parameters<typeof cancel>[0] & { coordinator?: unknown; events?: RunEventTarget | null }) => cancel(input);
export async function startChatRun(input: Parameters<typeof submit>[0] & { tools: PortfolioToolContext; approvals?: unknown; coordinator?: unknown; agentFactory?: AgentFactory; events?: RunEventTarget | null }) {
 const started = await submit(input);
 return executeSubmittedRun(input, started);
}
export async function executeSubmittedRun(input: Parameters<typeof submit>[0] & { tools: PortfolioToolContext; agentFactory?: AgentFactory; events?: RunEventTarget | null }, started: Awaited<ReturnType<typeof submit>>) {
 const db = await getDatabase(process.env.DATABASE_URL!);
 const jobs = agentJobs(db);
 const fence = await jobs.claim(randomUUID(), started.run.id);
 if (!fence) throw new Error('Test worker could not claim job');
 const done = (async () => {
  const owner = await jobs.owner(fence), chat = chatService(db, owner, fence);
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort('timeout'), parseServerConfig({ DATA_MODE: 'mock', ...process.env }).AGENT_WALL_CLOCK_MS);
  const heartbeat = setInterval(() => { void jobs.heartbeat(fence).then(state => { if (state === 'cancelled') stop.abort('cancelled'); }, () => stop.abort('lease_lost')); }, 20);
  try {
   await jobs.heartbeat(fence, true);
   const publisher = new RunEventPublisher(async e => { await appendRunProgress(db, fence, e); await input.events?.(e); }, { ownerId: input.ownerId, runId: started.run.id, conversationId: started.run.conversationId, messageId: started.run.assistantMessageId });
   await executeRun({ ...input, chat, approvals: approvalService(db, owner, () => new Date(), fence), conversation: await chat.get(started.run.conversationId), run: await chat.getRun(started.run.id), userMessage: started.userMessage, publisher, signal: stop.signal });
   const events = await chat.progress(started.run.id);
   for (const event of events.map(e => appEventSchema.parse(e)).filter(e => ['agent.message.completed','agent.run.completed'].includes(e.type))) await input.events?.(event);
  } finally { clearTimeout(timer); clearInterval(heartbeat); }
 })();
 return { ...started, run: await input.chat.getRun(started.run.id), done };
}
export async function reconcileStaleRuns(_input: { ownerId: string; chat: unknown; coordinator?: unknown; events?: RunEventTarget | null }) {
 const db = await getDatabase(process.env.DATABASE_URL!);
 const candidates = await db.agentRun.findMany({ where: { conversation: { ownerId: _input.ownerId }, status: { in: ['running','waiting_for_approval'] }, leaseUntil: { lte: new Date() } } });
 const count = await agentJobs(db).recover();
 for (const row of await db.outboxEvent.findMany({ where: { entityId: { in: candidates.map(r => r.id) }, type: { in: ['agent.message.completed','agent.run.completed'] } }, orderBy: { sequence: 'asc' } })) {
  await _input.events?.(appEventSchema.parse({ id: row.id, type: row.type, schemaVersion: row.schemaVersion, occurredAt: row.occurredAt.toISOString(), audience: { kind: 'user', userId: row.ownerId }, entityType: row.entityType, entityId: row.entityId, portfolioId: row.portfolioId, payload: row.payload }));
 }
 return count;
}

export async function leaseTestRun(db: Awaited<ReturnType<typeof getDatabase>>, runId: string): Promise<RunFence> {
 const row = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
 if (row.status === 'queued') {
  const fence = await agentJobs(db).claim(randomUUID(), runId);
  if (fence) return fence;
  const claimed = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (claimed.leaseOwner) return { runId, owner: claimed.leaseOwner, attempt: claimed.attempt };
  throw new Error('Test claim failed');
 }
 if (!row.leaseOwner) throw new Error('No test lease');
 return { runId, owner: row.leaseOwner, attempt: row.attempt };
}
export function testChat(db: Awaited<ReturnType<typeof getDatabase>>, base: ChatService): ChatService {
 return { ...base, async finishRun(runId, outcome) {
  const run = await base.getRun(runId);
  if (!['queued','running','waiting_for_approval'].includes(run.status)) return base.finishRun(runId, outcome);
  const fence = await leaseTestRun(db, runId);
  return chatService(db, await ownerForAgentRun(db, fence), fence).finishRun(runId, outcome);
 } };
}
export function testApprovals(db: Awaited<ReturnType<typeof getDatabase>>, base: ApprovalService): ApprovalService {
 async function worker(runId: string) { await base.list(runId); const row = await db.agentRun.findUniqueOrThrow({ where: { id: runId } }); if (!['queued','running','waiting_for_approval'].includes(row.status)) return base; const fence = await leaseTestRun(db, runId); return approvalService(db, await ownerForAgentRun(db, fence), () => new Date(), fence); }
 return { ...base, propose: async (runId, change) => (await worker(runId)).propose(runId, change),
  consume: async (id, runId, change) => { await base.get(id); return (await worker(runId)).consume(id, runId, change); } };
}

export async function redisRunEvents(): Promise<RunEventTarget | null> {
 const { optionalRedis, applicationCache } = await import('../cache');
 const redis = await optionalRedis();
 return redis ? event => publishEvent(redis, applicationCache().keys, event) : null;
}
