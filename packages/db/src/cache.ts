import { randomUUID } from 'node:crypto';
import type { AppEvent } from '@portfolio-pilot/contracts';
import { redisKeys, type RedisClient, type RedisKeys } from './redis-keys.js';

export interface CachePolicy { ttlMs: number; jitterRatio: number; negativeTtlMs?: number }
/**
 * Documented in ADR 0007. Quotes are ingested every ~30 s and judged stale after 15 min, so a 15 s
 * cache adds at most ~half an ingestion interval of delay. Owner news is also invalidated by events;
 * its TTL is only the backstop for a lost invalidation.
 */
export const CACHE_POLICIES = {
  quoteLatest: { ttlMs: 15000, jitterRatio: 0.2, negativeTtlMs: 5000 },
  ownerNews: { ttlMs: 60000, jitterRatio: 0.2 }
} as const satisfies Record<string, CachePolicy>;
/** Generation counters must outlive every cached value they version. */
export const GENERATION_TTL_MS = 30 * 24 * 3600000;
export const SINGLE_FLIGHT = { lockMs: 5000, waitMs: 1000, pollMs: 25 } as const;

/** Spread expirations uniformly over ttl ± ratio so keys written together do not expire together. */
export function jitteredTtl(ttlMs: number, ratio: number, random: () => number = Math.random): number {
  const spread = ttlMs * ratio;
  return Math.max(1, Math.round(ttlMs - spread + 2 * spread * random()));
}

const FAILED = Symbol('redis-failed');
const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
interface Parser<T> { safeParse(value: unknown): { success: true; data: T } | { success: false } }
export interface CacheOptions {
  redis: () => Promise<RedisClient | null>;
  namespace?: string; random?: () => number;
  opTimeoutMs?: number; cooldownMs?: number; lockMs?: number; waitMs?: number; pollMs?: number;
}

/**
 * Cache-aside over PostgreSQL. Redis is optional: any Redis error, timeout or absence falls through
 * to the authoritative loader, and a short cooldown avoids paying the timeout on every request.
 */
export function createCache(options: CacheOptions) {
  const keys = redisKeys(options.namespace);
  const random = options.random ?? Math.random;
  const opTimeoutMs = options.opTimeoutMs ?? 250, cooldownMs = options.cooldownMs ?? 5000;
  const lockMs = options.lockMs ?? SINGLE_FLIGHT.lockMs, waitMs = options.waitMs ?? SINGLE_FLIGHT.waitMs, pollMs = options.pollMs ?? SINGLE_FLIGHT.pollMs;
  const inflight = new Map<string, Promise<unknown>>();
  const stats = { hits: 0, misses: 0, loads: 0, coalesced: 0, waited: 0, bypassed: 0, redisErrors: 0 };
  let unavailableUntil = 0;

  async function op<T>(action: (redis: RedisClient) => Promise<T>): Promise<T | typeof FAILED> {
    if (Date.now() < unavailableUntil) return FAILED;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<typeof FAILED>(resolve => { timer = setTimeout(() => resolve(FAILED), opTimeoutMs); });
      const result = await Promise.race([(async () => { const redis = await options.redis(); return redis ? action(redis) : FAILED; })(), timeout]);
      if (result === FAILED) throw new Error('REDIS_UNAVAILABLE');
      return result;
    } catch {
      stats.redisErrors++; unavailableUntil = Date.now() + cooldownMs;
      return FAILED;
    } finally { clearTimeout(timer); }
  }
  function decode<T>(raw: string | null | typeof FAILED, schema: Parser<T>): { value: T } | null {
    if (raw === FAILED || raw === null) return null;
    try {
      const parsed = schema.safeParse((JSON.parse(raw) as { d: unknown }).d);
      return parsed.success ? { value: parsed.data } : null;
    } catch { return null; }
  }
  const store = (key: string, value: unknown, policy: CachePolicy) => op(redis => redis.set(key, JSON.stringify({ d: value }), {
    expiration: { type: 'PX', value: jitteredTtl(value === null && policy.negativeTtlMs ? policy.negativeTtlMs : policy.ttlMs, policy.jitterRatio, random) } }));

  async function fill<T>(key: string, policy: CachePolicy, schema: Parser<T>, loader: () => Promise<T>): Promise<T> {
    const lockKey = `${key}:lock`, token = randomUUID();
    const locked = await op(redis => redis.set(lockKey, token, { condition: 'NX', expiration: { type: 'PX', value: lockMs } }));
    if (locked === FAILED) { stats.bypassed++; stats.loads++; return loader(); }
    if (locked !== 'OK') {
      // Another process is loading this key: wait briefly for its value instead of stampeding PostgreSQL.
      stats.waited++;
      for (let waited = 0; waited < waitMs; waited += pollMs) {
        await new Promise(resolve => setTimeout(resolve, pollMs));
        const raw = await op(redis => redis.get(key));
        if (raw === FAILED) break;
        const hit = decode(raw, schema);
        if (hit) { stats.hits++; return hit.value; }
      }
      // The holder is slow or crashed (its lock expires on its own); correctness never depends on the lock.
    }
    try {
      stats.loads++;
      const value = await loader();
      await store(key, value, policy);
      return value;
    } finally {
      if (locked === 'OK') await op(redis => redis.eval(RELEASE, { keys: [lockKey], arguments: [token] }));
    }
  }

  return {
    keys, stats,
    /** Read-through with in-process and cross-process single-flight. Loader errors are never cached. */
    async getOrLoad<T>(key: string, policy: CachePolicy, schema: Parser<T>, loader: () => Promise<T>): Promise<T> {
      const hit = decode(await op(redis => redis.get(key)), schema);
      if (hit) { stats.hits++; return hit.value; }
      stats.misses++;
      const pending = inflight.get(key) as Promise<T> | undefined;
      if (pending) { stats.coalesced++; return pending; }
      const load = fill(key, policy, schema, loader).finally(() => inflight.delete(key));
      inflight.set(key, load);
      return load;
    },
    /** Current owner cache generation, or null when Redis cannot answer (callers then bypass the cache). */
    async generation(key: string): Promise<string | null> {
      const value = await op(redis => redis.get(key));
      return value === FAILED ? null : value ?? '0';
    }
  };
}
export type Cache = ReturnType<typeof createCache>;

/**
 * Event-driven invalidation, executed by the dispatcher BEFORE the event is appended to a stream.
 * A consumer reacting to an event therefore never refetches the pre-event cached value, and a
 * snapshot taken after capturing a stream cursor is at least as new as that cursor. Both
 * operations are idempotent, so duplicate delivery only costs an extra cache miss.
 */
export async function invalidateForEvent(redis: RedisClient, keys: RedisKeys, event: AppEvent): Promise<void> {
  // Agent-run progress changes no cached read model; bumping the generation per text chunk would
  // needlessly evict the owner's cached news.
  if (event.entityType === 'agent_run') return;
  if (event.audience.kind === 'user') {
    const key = keys.userGeneration(event.audience.userId);
    await redis.incr(key);
    await redis.pExpire(key, GENERATION_TTL_MS);
  } else if (event.type === 'quote.updated') {
    // One DEL per key: quote keys live in different cluster slots.
    for (const quote of event.payload.quotes) await redis.del(keys.quoteLatest(quote.securityId));
  }
}
