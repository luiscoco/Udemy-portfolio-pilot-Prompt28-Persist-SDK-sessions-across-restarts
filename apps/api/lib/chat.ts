import { randomUUID } from 'node:crypto';
import { chatMessageCreateSchema } from '@portfolio-pilot/contracts';
import { currentCursor, PortfolioError, type ChatService } from '@portfolio-pilot/db';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { chatPageQuerySchema } from '@portfolio-pilot/contracts';
import { applicationCache, optionalRedis } from './cache';
import { cursorCodec } from './event-cursor';
import { usdMicros, usdString } from './agent-budget-money';
export function chatPage(request: Request) {
  return chatPageQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
}
export async function chatBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > 10000) throw new PortfolioError(400, 'Request too large.');
  // Bound chunked bodies as well, without buffering an arbitrary upload first.
  const reader = request.body?.getReader();
  if (!reader) throw new PortfolioError(400, 'Expected JSON.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 10000) { await reader.cancel(); throw new PortfolioError(400, 'Request too large.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export const RUN_MESSAGES = {
  failed: 'The assistant could not complete this answer. Please try again. No trades were made. Previously approved changes remain saved; pending changes cannot execute.',
  analysisFailed: 'The structured analysis could not be validated against the articles that were actually read, so it is not shown. Please try again. No trades were made. Previously approved changes remain saved; pending changes cannot execute.',
  cancelled: 'You cancelled this answer before it finished. No trades were made. Previously approved changes remain saved; pending changes cannot execute.',
  interrupted: 'This answer was interrupted before it finished. Please try again. No trades were made. Previously approved changes remain saved; pending changes cannot execute.'
} as const;
async function streamRedis() {
  // Bounded like snapshot recovery: a Redis outage must not stall the POST.
  return Promise.race([optionalRedis().catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
}
/**
 * Race-free handshake: the cursor is captured BEFORE the run row exists, so every event the run
 * publishes is strictly after it. A client that subscribes (or replays) from it cannot miss events,
 * however fast the run is. Delivery is at-least-once; clients dedupe by event ID and sequence.
 */
export async function preRunCursor(ownerId: string): Promise<string | null> {
  const redis = await streamRedis();
  if (!redis) return null;
  try {
    const keys = applicationCache().keys;
    const [user, market] = await Promise.all([currentCursor(redis, keys, { kind: 'user', userId: ownerId }), currentCursor(redis, keys, { kind: 'market' })]);
    return cursorCodec().encode(ownerId, { user, market });
  } catch { return null; }
}


/** Submission persists a queued job. No SDK process runs in the API. */
export async function startChatRun(input: { ownerId: string; chat: ChatService; conversationId: string; body: unknown;
  replayCursor?: () => Promise<string | null> }) {
  const { content, kind } = chatMessageCreateSchema.parse(input.body);
  const conversation = await input.chat.get(input.conversationId);
  const replayCursor = await (input.replayCursor ?? (() => preRunCursor(input.ownerId)))();
  const config = parseServerConfig({ DATA_MODE: 'mock', ...process.env });
  const started = await input.chat.startRun(conversation.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content, kind,
    budget: { reserveUsd: usdString(usdMicros(config.AGENT_MAX_COST_USD, 'up') + usdMicros(config.AGENT_COST_OVERFLOW_USD, 'up')), dailyUsd: usdString(usdMicros(config.AGENT_DAILY_BUDGET_USD, 'down')) } });
  return { ...started, replayCursor };
}
export async function cancelChatRun(input: { ownerId: string; chat: ChatService; runId: string }) {
  return input.chat.requestCancel(input.runId);
}
