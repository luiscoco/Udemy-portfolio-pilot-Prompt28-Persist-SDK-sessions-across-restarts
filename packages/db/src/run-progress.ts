import { appEventSchema, type AppEvent } from '@portfolio-pilot/contracts';
import type { PrismaClient, Prisma } from './generated/prisma/client.js';
import { appendEvent } from './outbox.js';
import { assertRunFence, type RunFence } from './run-lease.js';
export const RUN_PROGRESS_LIMITS = { events: 512, bytes: 262144 } as const;
export async function persistRunEvent(tx: Prisma.TransactionClient, runId: string, sequence: number, event: AppEvent) {
 await tx.agentRunChunk.create({ data: { runId, sequence, event: event as unknown as Prisma.InputJsonValue } });
}
/** Each coalesced visible batch and its outbox record commit together. Never publish from worker memory. */
export async function appendRunProgress(db: PrismaClient, fence: RunFence, input: AppEvent) {
 const event = appEventSchema.parse(input);
 return db.$transaction(async tx => {
  const run = await tx.agentRun.findUniqueOrThrow({ where: { id: fence.runId } });
  await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id"=${run.conversationId} FOR UPDATE`;
  await assertRunFence(tx, fence);
  const current = await tx.agentRun.findUniqueOrThrow({ where: { id: fence.runId }, include: { conversation: true } });
  const payload = event.payload as { sequence?: number; conversationId?: string; messageId?: string };
  const bytes = Buffer.byteLength(JSON.stringify(event));
  if (current.cancelRequestedAt || event.entityId !== current.id || event.audience.kind !== 'user' || event.audience.userId !== current.conversation.ownerId ||
      payload.sequence !== current.nextSequence || payload.conversationId !== current.conversationId || payload.messageId !== current.assistantMessageId ||
      !event.type.startsWith('agent.') || ['agent.message.completed','agent.run.completed'].includes(event.type) ||
      current.nextSequence >= RUN_PROGRESS_LIMITS.events || current.progressBytes + bytes > RUN_PROGRESS_LIMITS.bytes) throw new Error('Run progress rejected');
  await appendEvent(tx, { ...event, occurredAt: new Date(event.occurredAt) } as Parameters<typeof appendEvent>[1]);
  await persistRunEvent(tx, current.id, current.nextSequence, event);
  await tx.agentRun.update({ where: { id: current.id }, data: { nextSequence: { increment: 1 }, progressBytes: { increment: bytes } } });
 });
}
