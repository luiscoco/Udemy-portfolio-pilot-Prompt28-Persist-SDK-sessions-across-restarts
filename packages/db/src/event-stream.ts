import { randomUUID } from 'node:crypto';
import { appEventSchema, type AppEvent } from '@portfolio-pilot/contracts';
import { invalidateForEvent } from './cache.js';
import type { RedisClient, RedisKeys } from './redis-keys.js';

/**
 * Bounded retention (ADR 0007). Streams are trimmed approximately by length on every append and
 * expire after 30 idle days. A cursor is replayable only while all later entries still exist AND it
 * is inside the replay window; otherwise the reader must reset to a PostgreSQL snapshot.
 */
export const STREAM_RETENTION = {
  replayWindowMs: 7 * 24 * 3600000,
  userStreamMaxEntries: 1000,
  marketStreamMaxEntries: 10000,
  idleExpiryMs: 30 * 24 * 3600000
} as const;

export type StreamScope = { kind: 'user'; userId: string } | { kind: 'market' };
const streamKey = (keys: RedisKeys, scope: StreamScope) => scope.kind === 'user' ? keys.userStream(scope.userId) : keys.marketStream;

/**
 * The epoch identifies one Redis dataset. If Redis loses its data, a new epoch is created, so every
 * cursor issued before the loss becomes invalid instead of silently skipping lost entries.
 */
export async function streamEpoch(redis: RedisClient, keys: RedisKeys): Promise<string> {
  await redis.set(keys.epoch, randomUUID(), { condition: 'NX' });
  const epoch = await redis.get(keys.epoch);
  if (!epoch) throw new Error('STREAM_EPOCH_UNAVAILABLE');
  return epoch;
}

// Cursor = opaque token for a stream position. It is NOT the domain event ID (event.id is).
export function encodeCursor(epoch: string, entryId: string): string { return `v1.${epoch}.${entryId}`; }
export function decodeCursor(cursor: string): { epoch: string; entryId: string } | null {
  const match = /^v1\.([0-9a-f-]{36})\.(\d+-\d+)$/.exec(cursor);
  return match ? { epoch: match[1]!, entryId: match[2]! } : null;
}
export function compareEntryIds(a: string, b: string): number {
  const [am, as] = a.split('-').map(BigInt) as [bigint, bigint], [bm, bs] = b.split('-').map(BigInt) as [bigint, bigint];
  return am === bm ? (as === bs ? 0 : as < bs ? -1 : 1) : am < bm ? -1 : 1;
}
async function serverTimeMs(redis: RedisClient): Promise<number> {
  const [seconds, micros] = await redis.time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}
async function streamInfo(redis: RedisClient, key: string) {
  if (!await redis.exists(key)) return null;
  const info = await redis.xInfoStream(key) as unknown as Record<string, unknown>;
  return { lastId: String(info['last-generated-id']), maxDeletedId: String(info['max-deleted-entry-id'] ?? '0-0'), firstId: String(info['recorded-first-entry-id'] ?? '0-0'),
    length: Number(info.length), entriesAdded: Number(info['entries-added']) };
}
/**
 * True when an entry after the cursor may no longer exist. Redis updates max-deleted-entry-id for
 * XDEL but NOT for MAXLEN/XTRIM trimming, so head trimming is detected separately and conservatively:
 * once anything was removed, a cursor older than the first retained entry resets. At the exact trim
 * boundary that can reset unnecessarily; it can never skip a lost entry.
 */
function gapAfter(cursorId: string, info: NonNullable<Awaited<ReturnType<typeof streamInfo>>>): boolean {
  if (compareEntryIds(cursorId, info.maxDeletedId) < 0) return true;
  if (info.entriesAdded <= info.length) return false;
  return compareEntryIds(cursorId, info.length ? info.firstId : info.lastId) < 0;
}

/** Publishes one user/market event. System events are handled in PostgreSQL and never published. */
export async function publishEvent(redis: RedisClient, keys: RedisKeys, event: AppEvent): Promise<{ streamKey: string; entryId: string }> {
  if (event.audience.kind === 'system') throw new Error('SYSTEM_EVENT_NOT_PUBLISHABLE');
  // Invalidate first: see invalidateForEvent for the ordering guarantee this provides.
  await invalidateForEvent(redis, keys, event);
  await streamEpoch(redis, keys);
  const scope: StreamScope = event.audience.kind === 'user' ? { kind: 'user', userId: event.audience.userId } : { kind: 'market' };
  const key = streamKey(keys, scope);
  const threshold = scope.kind === 'user' ? STREAM_RETENTION.userStreamMaxEntries : STREAM_RETENTION.marketStreamMaxEntries;
  // Redis assigns the entry ID (the cursor). The stable domain ID travels inside the entry.
  const entryId = await redis.xAdd(key, '*', { eventId: event.id, type: event.type, schemaVersion: String(event.schemaVersion), envelope: JSON.stringify(event) },
    { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold } });
  await redis.pExpire(key, STREAM_RETENTION.idleExpiryMs);
  return { streamKey: key, entryId };
}

/**
 * Snapshot recovery handshake: capture this cursor BEFORE reading the PostgreSQL snapshot. Every
 * event committed after the snapshot is published after the cursor and will be replayed; events
 * already reflected in the snapshot may also replay, which idempotent consumers tolerate.
 */
export async function currentCursor(redis: RedisClient, keys: RedisKeys, scope: StreamScope): Promise<string> {
  const epoch = await streamEpoch(redis, keys);
  const info = await streamInfo(redis, streamKey(keys, scope));
  // Empty stream: any future auto-generated ID is at least the current server millisecond.
  return encodeCursor(epoch, info?.lastId ?? `${(await serverTimeMs(redis)) - 1}-0`);
}

export type StreamRead =
  | { status: 'ok'; cursor: string; events: { cursor: string; event: AppEvent }[]; skipped: number }
  | { status: 'reset'; reason: 'invalid_cursor' | 'epoch_changed' | 'expired' | 'trimmed' };
export async function readEvents(redis: RedisClient, keys: RedisKeys, scope: StreamScope, cursor: string, count = 100): Promise<StreamRead> {
  const position = decodeCursor(cursor);
  if (!position) return { status: 'reset', reason: 'invalid_cursor' };
  const epoch = await redis.get(keys.epoch);
  if (epoch !== position.epoch) return { status: 'reset', reason: 'epoch_changed' };
  if (Number(position.entryId.split('-')[0]) < await serverTimeMs(redis) - STREAM_RETENTION.replayWindowMs) return { status: 'reset', reason: 'expired' };
  const key = streamKey(keys, scope);
  const info = await streamInfo(redis, key);
  if (!info) return { status: 'ok', cursor, events: [], skipped: 0 };
  // Anything deleted after our position means a gap we cannot replay.
  if (gapAfter(position.entryId, info)) return { status: 'reset', reason: 'trimmed' };
  const entries = await redis.xRange(key, `(${position.entryId}`, '+', { COUNT: Math.min(Math.max(count, 1), 1000) });
  const events: { cursor: string; event: AppEvent }[] = [];
  let last = position.entryId, skipped = 0;
  for (const entry of entries) {
    last = String(entry.id);
    let parsed: AppEvent | null = null;
    try { const result = appEventSchema.safeParse(JSON.parse(String(entry.message.envelope))); parsed = result.success ? result.data : null; } catch { parsed = null; }
    // Defense in depth: an entry whose audience does not match the stream owner is never surfaced.
    const authorized = parsed && (scope.kind === 'user' ? parsed.audience.kind === 'user' && parsed.audience.userId === scope.userId : parsed.audience.kind === 'market');
    if (parsed && authorized) events.push({ cursor: encodeCursor(position.epoch, last), event: parsed }); else skipped++;
  }
  return { status: 'ok', cursor: encodeCursor(position.epoch, last), events, skipped };
}

/**
 * At-least-once delivery means the same domain event can arrive twice (republish after a crash,
 * replay after a snapshot). Consumers key side effects by the stable event UUID, never the cursor.
 */
export class EventDeduper {
  private readonly seen = new Map<string, true>();
  constructor(private readonly capacity = 10000) {}
  has(eventId: string): boolean { return this.seen.has(eventId); }
  remember(eventId: string): void {
    this.seen.set(eventId, true);
    if (this.seen.size > this.capacity) this.seen.delete(this.seen.keys().next().value!);
  }
}
/** Remembers an event only after its handler succeeds, so a failed handler is retried on redelivery. */
export async function consumeOnce(events: { event: AppEvent }[], deduper: EventDeduper, handler: (event: AppEvent) => Promise<void> | void): Promise<number> {
  let applied = 0;
  for (const { event } of events) {
    if (deduper.has(event.id)) continue;
    await handler(event);
    deduper.remember(event.id); applied++;
  }
  return applied;
}
