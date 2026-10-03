import { eventRecoverySchema, type EventRecovery } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import type { Cache } from './cache.js';
import { newsReads } from './cached-reads.js';
import { currentCursor, STREAM_RETENTION } from './event-stream.js';
import { portfolioService } from './portfolio-service.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import type { RedisClient } from './redis-keys.js';
import { watchlistService } from './watchlist-service.js';

/**
 * Snapshot recovery for a client whose cursor was reset (expired, trimmed, epoch changed) or that is
 * starting fresh. Cursors are captured first, then the owner's state is read; the client applies the
 * snapshot and replays strictly after the returned cursors, deduplicating by event UUID.
 * Without Redis the cursors are null: the snapshot is still valid, but live replay is unavailable.
 */
export async function recoverySnapshot(db: PrismaClient, redis: RedisClient | null, cache: Cache, owner: AuthenticatedOwner): Promise<EventRecovery> {
  const userId = requireOwner(owner);
  let streams: EventRecovery['streams'] = { user: null, market: null };
  if (redis) {
    try {
      const [user, market] = await Promise.all([currentCursor(redis, cache.keys, { kind: 'user', userId }), currentCursor(redis, cache.keys, { kind: 'market' })]);
      streams = { user, market };
    } catch { /* stream unavailable: snapshot only */ }
  }
  const [portfolios, watchlist, news] = await Promise.all([
    portfolioService(db, owner).list(), watchlistService(db, owner).list(), newsReads(db, cache, owner).feed({})
  ]);
  return eventRecoverySchema.parse({
    streams, news, watchlist, snapshotAt: new Date().toISOString(),
    retention: { replayWindowMs: STREAM_RETENTION.replayWindowMs, userStreamMaxEntries: STREAM_RETENTION.userStreamMaxEntries, marketStreamMaxEntries: STREAM_RETENTION.marketStreamMaxEntries },
    portfolios: portfolios.map(p => ({ id: p.id, name: p.name, currency: p.currency, archivedAt: p.archivedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }))
  });
}
