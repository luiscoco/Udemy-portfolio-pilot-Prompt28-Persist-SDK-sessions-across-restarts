import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { agentJobs, AGENT_JOB_POLICY, appendRunProgress, chatService, approvalService, agentToolReads, createCache, getDatabase, getRedis } from '@portfolio-pilot/db';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { executeRun } from './agent-execution.js';
import { RunEventPublisher } from './agent-run-events.js';
import { artifactAgentFactory, configuredArtifactStore } from './agent-artifacts.js';
export async function runAgentWorker(shutdown: AbortSignal) {
 const config = parseServerConfig(process.env);
 if (!config.DATABASE_URL) throw new Error('Agent worker requires DATABASE_URL');
 const db = await getDatabase(config.DATABASE_URL);
 const jobs = agentJobs(db), ownerKey = randomUUID();
 const artifacts = configuredArtifactStore(config);
 let pruneAt = 0;
 const cache = createCache({ redis: async () => config.REDIS_URL ? getRedis(config.REDIS_URL) : null });
 while (!shutdown.aborted) {
  try {
   if (Date.now() >= pruneAt) { await artifacts.prune(); pruneAt = Date.now() + 3600000; }
   await jobs.recover();
   const fence = await jobs.claim(ownerKey);
   if (fence) {
    const stop = new AbortController();
    const abort = () => stop.abort('worker_shutdown');
    shutdown.addEventListener('abort', abort, { once: true });
    if (shutdown.aborted) abort();
    const timer = setTimeout(() => stop.abort('timeout'), config.AGENT_WALL_CLOCK_MS);
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    const pulse = async () => {
     try { if (await jobs.heartbeat(fence) === 'cancelled') stop.abort('cancelled'); }
     catch { stop.abort('lease_lost'); }
     if (!stop.signal.aborted) heartbeat = setTimeout(() => { void pulse(); }, AGENT_JOB_POLICY.heartbeatMs);
    };
    try {
     if (await jobs.heartbeat(fence, true) === 'cancelled') stop.abort('cancelled');
     const owner = await jobs.owner(fence), chat = chatService(db, owner, fence);
     const run = await chat.getRun(fence.runId), conversation = await chat.get(run.conversationId);
     const user = await db.chatMessage.findUniqueOrThrow({ where: { id: run.userMessageId } });
     const userMessage = (await chat.messages(run.conversationId, { limit: 50 })).messages.find(m => m.id === user.id)!;
     const publisher = new RunEventPublisher(async event => { try { await appendRunProgress(db, fence, event); } catch (error) { stop.abort('progress_failure'); throw error; } }, { ownerId: owner.userId, runId: run.id, conversationId: conversation.id, messageId: run.assistantMessageId });
     void pulse();
     await executeRun({ ownerId: owner.userId, chat, approvals: approvalService(db, owner, () => new Date(), fence),
      agentFactory: artifactAgentFactory(artifacts, { ownerId: owner.userId, conversationId: conversation.id }, config),
      tools: { data: agentToolReads(db, cache, owner), dataMode: config.DATA_MODE }, run, conversation, userMessage, publisher, signal: stop.signal });
    } finally { clearTimeout(timer); clearTimeout(heartbeat); stop.abort('settled'); shutdown.removeEventListener('abort', abort); }
   }
  } catch { console.error('Agent job unavailable or interrupted; durable recovery will reconcile its lease.'); }
  if (process.env.WORKER_ONCE === 'true') break;
  await sleep(AGENT_JOB_POLICY.pollMs, undefined, { signal: shutdown });
 }
}
