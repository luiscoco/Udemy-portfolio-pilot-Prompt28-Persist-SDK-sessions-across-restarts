import { assertRunFence, type RunFence } from './run-lease.js';
import { appendEvent, uuidV5 } from './outbox.js';
import { persistRunEvent } from './run-progress.js';
import { agentRunSchema, chatMessageSchema, chatPageQuerySchema, conversationCreateSchema, conversationSchema, type ChatRunKind, type ChatSource, type NewsAnalysis, type SessionContinuity } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';
import { reserveAgentBudget, type BudgetReservation } from './agent-budget.js';

export function chatService(db: PrismaClient, owner: AuthenticatedOwner, fence?: RunFence, recovery = false) {
  const ownerId = requireOwner(owner);
  const dto = (row: { createdAt: Date; updatedAt: Date }) => conversationSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  const messageDto = (row: { createdAt: Date }) => chatMessageSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
  const runDto = (row: { id: string; conversationId: string; status: string; kind: string; userMessageId: string; assistantMessageId: string; cancelRequestedAt: Date | null; createdAt: Date; completedAt: Date | null; usage?: unknown; actualModel?: string | null; failureCode?: string | null; attempt?: number; heartbeatAt?: Date | null; leaseUntil?: Date | null }) =>
    agentRunSchema.parse({ id: row.id, conversationId: row.conversationId, status: row.status, kind: row.kind, userMessageId: row.userMessageId, assistantMessageId: row.assistantMessageId,
      attempt: row.attempt ?? 0, heartbeatAt: row.heartbeatAt?.toISOString() ?? null, leaseExpiresAt: row.leaseUntil?.toISOString() ?? null,
      usage: row.usage ?? null, actualModel: row.actualModel ?? null, failureCode: row.failureCode ?? null,
      cancelRequested: row.cancelRequestedAt !== null, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null });
  async function ownedRun(runId: string) {
    const row = await db.agentRun.findFirst({ where: { id: runId, conversation: { ownerId } } });
    if (!row) throw new PortfolioError(404, 'Resource not found.');
    return row;
  }
  /**
   * The only running -> terminal transition. The conditional update makes it exactly-once across
   * concurrent finishers (worker, cancel, stale reconciliation); the loser gets null and must not
   * announce a second outcome. The assistant message reuses the run's reserved application ID.
   */
  async function finishRun(runId: string, outcome: RunOutcome) {
    return db.$transaction(async tx => {
      // Same conversation -> day lock order as admission. Without this, a remote admission on
      // this conversation could hold its row while waiting for the finisher's daily ledger lock.
      const target = await tx.agentRun.findFirst({ where: { id: runId, conversation: { ownerId } }, select: { conversationId: true } });
      if (!target) throw new PortfolioError(404, 'Resource not found.');
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id"=${target.conversationId} AND "ownerId"=${ownerId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "id"=${runId} FOR UPDATE`;
      const run = await tx.agentRun.findFirst({ where: { id: runId, conversation: { ownerId } } });
      if (!run) throw new PortfolioError(404, 'Resource not found.');
      if (!['queued','running','waiting_for_approval'].includes(run.status)) return null;
      if (!fence && run.status === 'queued' && outcome.status !== 'cancelled') throw new PortfolioError(409, 'A worker attempt is required.');
      if (fence) { if (fence.runId !== runId) throw new PortfolioError(409, 'Worker run mismatch.'); await assertRunFence(tx, fence); }
      else if (run.status !== 'queued') {
        if (!recovery) throw new PortfolioError(409, 'A worker attempt is required.');
        const expired = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AgentRun" WHERE "id"=${runId} AND ("leaseUntil" IS NULL OR "leaseUntil"<=clock_timestamp())`;
        if (!expired.length) return null;
      }
      if (run.budgetDay && !outcome.usage) outcome = { ...outcome, usage: {
        accounting: 'conservative', estimatedCostUsd: '0.000000', aggregateTokens: 0, turns: 0, resultCount: 0
      } };
      if (run.cancelRequestedAt && outcome.status !== 'cancelled') outcome = { ...outcome, status: 'cancelled', failureCode: null, analysis: null, content: 'You cancelled this answer. Previously approved changes remain saved; pending changes were cancelled.' };
      if (outcome.status === 'completed' && outcome.checkpoint) {
        if (!fence) throw new PortfolioError(409, 'A worker attempt is required.');
        const { expectedGeneration, binding } = outcome.checkpoint;
        const current = await tx.conversationSession.findUnique({ where: { conversationId: run.conversationId } });
        if ((current?.generation ?? null) !== expectedGeneration) throw new PortfolioError(409, 'Session checkpoint changed.');
        const data = { sdkSessionId: binding.sdkSessionId, agentMode: binding.agentMode, hostKey: binding.hostKey,
          modelKey: binding.modelKey, instructionVersion: binding.instructionVersion, lastRunId: runId,
          artifactKey: binding.artifact.key, artifactSha256: binding.artifact.sha256, artifactExpiresAt: new Date(binding.artifact.expiresAt) };
        await tx.conversationSession.upsert({ where: { conversationId: run.conversationId },
          create: { conversationId: run.conversationId, ...data }, update: { ...data, generation: { increment: 1 } } });
      }
      const completedAt = new Date();
      const known = outcome.usage?.estimatedCostUsd ?? '0.000000';
      const charged = outcome.usage?.accounting === 'sdk_estimate' || outcome.usage?.accounting === 'mock' || outcome.usage?.accounting === 'not_started' ? known
        : (run.reservedUsd.greaterThan(known) ? run.reservedUsd.toFixed(6) : known);
      const moved = await tx.agentRun.updateMany({ where: { id: runId, status: { in: ['queued', 'running', 'waiting_for_approval'] } }, data: { leaseOwner: null, leaseUntil: null, status: outcome.status, failureCode: outcome.failureCode, completedAt,
        chargedUsd: charged, ...(outcome.usage ? { usage: outcome.usage } : {}), actualModel: outcome.actualModel ?? null,
        ...(outcome.attempts === undefined ? {} : { attempts: outcome.attempts }) } });
      if (!moved.count) return null;
      if (run.budgetDay) await tx.$executeRaw`
        UPDATE "DailyAgentBudget" SET "reservedUsd" = "reservedUsd" - ${run.reservedUsd}::numeric,
          "chargedUsd" = "chargedUsd" + ${charged}::numeric WHERE "ownerId" = ${ownerId} AND "day" = ${run.budgetDay}`;
      await tx.approvalRequest.updateMany({ where: { runId, ownerId, status: { in: ['pending', 'approved'] } }, data: { status: outcome.status === 'cancelled' ? 'cancelled' : 'invalidated' } });
      await tx.conversation.update({ where: { id: run.conversationId }, data: { updatedAt: completedAt, leaseOwner: null, leaseUntil: null, leaseRunId: null } });
      const message = await tx.chatMessage.create({ data: { id: run.assistantMessageId, conversationId: run.conversationId, role: 'assistant', status: outcome.status,
        ...(outcome.usage ? { usage: outcome.usage } : {}), actualModel: outcome.actualModel ?? null,
        content: outcome.content, mode: outcome.mode, instructionVersion: outcome.instructionVersion, sources: outcome.sources, kind: run.kind,
        // Only a completed run may carry an analysis; failures never persist unvalidated structure.
        ...(outcome.status === 'completed' && outcome.analysis ? { analysis: outcome.analysis } : {}),
        ...(outcome.continuity ? { continuity: outcome.continuity } : {}) } });
      for (const [offset, type] of ['agent.message.completed', 'agent.run.completed'].entries()) {
        const sequence = run.nextSequence + offset;
        const event = await appendEvent(tx, { id: uuidV5(`agent-run:${runId}:${sequence}`), type,
          audience: { kind: 'user', userId: ownerId }, entityType: 'agent_run', entityId: runId, portfolioId: null,
          payload: { conversationId: run.conversationId, messageId: run.assistantMessageId, sequence,
            ...(type === 'agent.message.completed' ? { message: messageDto(message) } : { status: outcome.status }) } } as Parameters<typeof appendEvent>[1]);
        await persistRunEvent(tx, runId, sequence, event);
      }
      await tx.agentRun.update({ where: { id: runId }, data: { nextSequence: { increment: 2 } } });
      return { run: runDto({ ...run, status: outcome.status, failureCode: outcome.failureCode, usage: outcome.usage ?? null, actualModel: outcome.actualModel ?? null, completedAt }), message: messageDto(message) };
    });
  }
  async function get(id: string) {
    const row = await db.conversation.findFirst({ where: { id, ownerId } });
    if (!row) throw new PortfolioError(404, 'Resource not found.');
    return dto(row);
  }
  return {
    get,
    async progress(runId: string) {
      await ownedRun(runId);
      return (await db.agentRunChunk.findMany({ where: { runId }, orderBy: { sequence: 'asc' }, take: 514 })).map(row => row.event);
    },
    async create(input: unknown) {
      const data = conversationCreateSchema.parse(input);
      if (data.portfolioId && !await db.portfolio.findFirst({ where: { id: data.portfolioId, ownerId } })) throw new PortfolioError(404, 'Resource not found.');
      return dto(await db.conversation.create({ data: { ...data, ownerId } }));
    },
    async list(input: unknown) {
      const { limit, before } = chatPageQuerySchema.parse(input);
      const anchor = before ? await get(before) : null;
      const rows = await db.conversation.findMany({ where: { ownerId, ...(anchor ? { OR: [{ createdAt: { lt: new Date(anchor.createdAt) } }, { createdAt: new Date(anchor.createdAt), id: { lt: anchor.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
      return { conversations: rows.slice(0, limit).map(dto), nextBefore: rows.length > limit ? rows[limit - 1]!.id : null };
    },
    async messages(id: string, input: unknown) {
      await get(id);
      const { limit, before } = chatPageQuerySchema.parse(input);
      const anchor = before ? await db.chatMessage.findFirst({ where: { id: before, conversationId: id, conversation: { ownerId } } }) : null;
      if (before && !anchor) throw new PortfolioError(404, 'Resource not found.');
      const rows = await db.chatMessage.findMany({ where: { conversationId: id, conversation: { ownerId }, ...(anchor ? { sequence: { lt: anchor.sequence } } : {}) }, orderBy: { sequence: 'desc' }, take: limit + 1 });
      return { messages: rows.slice(0, limit).reverse().map(messageDto), nextBefore: rows.length > limit ? rows[limit - 1]!.id : null };
    },
    async append(id: string, input: { role: 'user' | 'assistant'; content: string; status: 'completed' | 'failed'; mode: 'mock' | 'claude' | null; instructionVersion: string | null; sources: ChatSource[] }) {
      // Ownership is checked again inside the transaction; no naked message-by-ID writes.
      return db.$transaction(async tx => {
        const changed = await tx.conversation.updateMany({ where: { id, ownerId }, data: { updatedAt: new Date() } });
        if (!changed.count) throw new PortfolioError(404, 'Resource not found.');
        return messageDto(await tx.chatMessage.create({ data: { ...input, conversationId: id } }));
      });
    },
    /** Persists the user message and a running run atomically; a second running run in the conversation is a 409. */
    async startRun(id: string, input: { runId: string; assistantMessageId: string; content: string; kind?: ChatRunKind; budget?: BudgetReservation }) {
      try {
        return await db.$transaction(async tx => {
          const changed = await tx.conversation.updateMany({ where: { id, ownerId }, data: { updatedAt: new Date() } });
          if (!changed.count) throw new PortfolioError(404, 'Resource not found.');
          if (await tx.agentRun.findFirst({ where: { conversationId: id, status: { in: ['queued','running','waiting_for_approval'] } } })) throw new PortfolioError(409, 'This conversation is already answering. Wait for it or cancel it first.');
          const budget = input.budget ?? { reserveUsd: '0.2', dailyUsd: '2' };
          const budgetDay = await reserveAgentBudget(tx, ownerId, budget);
          const kind = input.kind ?? 'answer';
          const user = await tx.chatMessage.create({ data: { conversationId: id, role: 'user', content: input.content, status: 'completed', mode: null, instructionVersion: null, sources: [], kind } });
          const run = await tx.agentRun.create({ data: { id: input.runId, conversationId: id, userMessageId: user.id, assistantMessageId: input.assistantMessageId, status: 'queued', kind, budgetDay, reservedUsd: budget.reserveUsd } });
          return { run: runDto(run), userMessage: messageDto(user) };
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw new PortfolioError(409, 'This conversation is already answering. Wait for it or cancel it first.');
        throw error;
      }
    },
    finishRun,
    async getRun(runId: string) { return runDto(await ownedRun(runId)); },
    async activeRun(id: string) {
      await get(id);
      const row = await db.agentRun.findFirst({ where: { conversationId: id, status: { in: ['queued', 'running', 'waiting_for_approval'] }, conversation: { ownerId } } });
      return row ? runDto(row) : null;
    },
    /** Durable cancellation request; idempotent, and a no-op for a run that already finished. */
    async requestCancel(runId: string) {
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "AgentRun" WHERE "id"=${runId} FOR UPDATE`;
        const run = await tx.agentRun.findFirst({ where: { id: runId, conversation: { ownerId } } });
        if (!run) throw new PortfolioError(404, 'Resource not found.');
        await tx.agentRun.updateMany({ where: { id: runId, status: { in: ['queued','running','waiting_for_approval'] }, cancelRequestedAt: null }, data: { cancelRequestedAt: new Date() } });
        await tx.approvalRequest.updateMany({ where: { runId, ownerId, status: { in: ['pending','approved'] } }, data: { status: 'cancelled' } });
      });
      const row = await ownedRun(runId);
      if (row.status === 'queued') await finishRun(runId, { status: 'cancelled', failureCode: null, content: 'You cancelled this queued answer.', mode: null, instructionVersion: null, sources: [], usage: { accounting: 'not_started', estimatedCostUsd: '0.000000', aggregateTokens: 0, turns: 0, resultCount: 0 } });
      return runDto(await ownedRun(runId));
    },
    /**
     * The conversation's current SDK session binding, or null. The binding names a session; it does
     * not contain the transcript, which exists only in SDK session files on the host that wrote them.
     */
    async sessionBinding(id: string): Promise<SessionBinding | null> {
      const row = await db.conversationSession.findFirst({ where: { conversationId: id, conversation: { ownerId } } });
      return row ? { sdkSessionId: row.sdkSessionId, agentMode: row.agentMode as SessionBinding['agentMode'], hostKey: row.hostKey, instructionVersion: row.instructionVersion, modelKey: row.modelKey, generation: row.generation,
        ...(row.artifactKey && row.artifactSha256 && row.artifactExpiresAt ? { artifact: { key: row.artifactKey, sha256: row.artifactSha256, expiresAt: row.artifactExpiresAt.toISOString() } } : {}) } : null;
    },
    /**
     * Compare-and-set: records `next` only if the binding is still at `expectedGeneration` (null =
     * none yet). Turns are serialized per conversation, so a lost race means another writer (for
     * example a run that outlived a restart) already moved the binding; the caller keeps theirs.
     */
    async bindSession(id: string, expectedGeneration: number | null, next: Omit<SessionBinding, 'generation'> & { runId: string }): Promise<boolean> {
      const data = { sdkSessionId: next.sdkSessionId, agentMode: next.agentMode, hostKey: next.hostKey, instructionVersion: next.instructionVersion, modelKey: next.modelKey, lastRunId: next.runId, artifactKey: null, artifactSha256: null, artifactExpiresAt: null };
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id"=${id} AND "ownerId"=${ownerId} FOR UPDATE`;
        if (fence) { if (fence.runId !== next.runId || !await tx.agentRun.findFirst({ where: { id: fence.runId, conversationId: id } })) throw new PortfolioError(409, 'Worker run mismatch.'); await assertRunFence(tx, fence); }
        else throw new PortfolioError(409, 'A worker attempt is required.');
        if (!await tx.conversation.findFirst({ where: { id, ownerId }, select: { id: true } })) throw new PortfolioError(404, 'Resource not found.');
        if (expectedGeneration === null) {
          const inserted = await tx.conversationSession.createMany({ data: [{ conversationId: id, ...data }], skipDuplicates: true });
          return inserted.count === 1;
        }
        const moved = await tx.conversationSession.updateMany({ where: { conversationId: id, generation: expectedGeneration }, data: { ...data, generation: { increment: 1 } } });
        return moved.count === 1;
      });
    }
  };
}
export type RunOutcome = {
  checkpoint?: { expectedGeneration: number | null; binding: Omit<SessionBinding, 'generation' | 'artifact'> & { artifact: { key: string; sha256: string; expiresAt: string } } };
  usage?: import('@portfolio-pilot/contracts').AgentUsage; actualModel?: string | null;
  status: 'completed' | 'failed' | 'cancelled'; failureCode: string | null; content: string; mode: 'mock' | 'claude' | null; instructionVersion: string | null; sources: ChatSource[];
  analysis?: NewsAnalysis | null; continuity?: SessionContinuity | null; attempts?: number;
};
export type SessionBinding = { sdkSessionId: string; agentMode: 'mock' | 'claude'; hostKey: string; instructionVersion: string; modelKey: string; generation: number; artifact?: { key: string; sha256: string; expiresAt: string } };
export type ChatService = ReturnType<typeof chatService>;
