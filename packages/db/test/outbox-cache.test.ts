import { describe, expect, it } from 'vitest';
import { buildEvent, uuidV5 } from '../src/outbox.js';
import { createCache, jitteredTtl } from '../src/cache.js';
import { compareEntryIds, consumeOnce, decodeCursor, encodeCursor, EventDeduper } from '../src/event-stream.js';
import { redisKeys } from '../src/redis-keys.js';

const anything = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
const policy = { ttlMs: 1000, jitterRatio: 0 };
const event = (id?: string) => buildEvent({ ...(id ? { id } : {}), type: 'watchlist.updated', audience: { kind: 'user', userId: 'alice' }, entityType: 'watchlist_entry', entityId: 'w1', portfolioId: null, payload: { change: 'added', securityId: 's1' } });

describe('outbox identity', () => {
  it('derives deterministic RFC 9562 version 5 UUIDs for fan-out redelivery', () => {
    const id = uuidV5('source:alice');
    expect(id).toBe(uuidV5('source:alice'));
    expect(id).not.toBe(uuidV5('source:bob'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('stamps a stable UUID, schema version and UTC timestamp, validating the payload', () => {
    const built = event();
    expect(built.schemaVersion).toBe(1);
    expect(built.occurredAt.endsWith('Z')).toBe(true);
    expect(event(built.id).id).toBe(built.id);
    expect(() => buildEvent({ type: 'portfolio.updated', audience: { kind: 'market' }, entityType: 'portfolio', entityId: 'p', portfolioId: 'p', payload: { change: 'created', transactionId: null } } as never)).toThrow();
  });
});

describe('cache policy', () => {
  it('jitters TTLs uniformly within ±ratio', () => {
    expect(jitteredTtl(15000, 0.2, () => 0)).toBe(12000);
    expect(jitteredTtl(15000, 0.2, () => 0.999999)).toBe(18000);
    expect(jitteredTtl(15000, 0.2, () => 0.5)).toBe(15000);
  });
  it('versions keys and scopes owner keys by user and portfolio', () => {
    const keys = redisKeys('pp');
    expect(keys.ownerNews('alice', '3', 'p1', 20)).toBe('pp:v1:cache:news:user:{alice}:g3:portfolio:p1:limit:20');
    expect(keys.ownerNews('alice', '3', null, 20)).not.toBe(keys.ownerNews('bob', '3', null, 20));
    expect(keys.userStream('alice')).toBe('pp:v1:events:user:{alice}');
    expect(() => keys.userStream('alice}:x')).toThrow('INVALID_KEY_ID');
    expect(() => keys.quoteLatest('a:b')).toThrow('INVALID_KEY_ID');
  });
  it('coalesces concurrent in-process misses into one load and falls through to the loader without Redis', async () => {
    let loads = 0;
    const cache = createCache({ redis: async () => null });
    const loader = async () => { loads++; await new Promise(resolve => setTimeout(resolve, 20)); return { value: 42 }; };
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrLoad('pp:v1:k', policy, anything, loader)));
    expect(loads).toBe(1);
    expect(results.every(result => (result as { value: number }).value === 42)).toBe(true);
    expect(cache.stats.coalesced).toBe(19);
    expect(await cache.generation('pp:v1:g')).toBeNull();
  });
  it('fails open to PostgreSQL when Redis throws, and does not cache loader errors', async () => {
    const cache = createCache({ redis: async () => { throw new Error('down'); } });
    expect(await cache.getOrLoad('k', policy, anything, async () => 'authoritative')).toBe('authoritative');
    await expect(cache.getOrLoad('k', policy, anything, async () => { throw new Error('db'); })).rejects.toThrow('db');
    expect(await cache.getOrLoad('k', policy, anything, async () => 'again')).toBe('again');
  });
});

describe('stream cursors and idempotent consumers', () => {
  it('encodes opaque epoch cursors and orders entry IDs numerically', () => {
    const cursor = encodeCursor('0b8f4bd4-5f0c-4c55-9a43-3cf0a3a5c1d2', '1700000000000-10');
    expect(decodeCursor(cursor)).toEqual({ epoch: '0b8f4bd4-5f0c-4c55-9a43-3cf0a3a5c1d2', entryId: '1700000000000-10' });
    expect(decodeCursor('1700000000000-10')).toBeNull();
    expect(compareEntryIds('1700000000000-9', '1700000000000-10')).toBe(-1);
    expect(compareEntryIds('999-0', '1000-0')).toBe(-1);
    expect(compareEntryIds('1000-1', '1000-1')).toBe(0);
  });
  it('applies each event UUID once, retries after a failed handler and bounds memory', async () => {
    const first = event(), second = event();
    const deduper = new EventDeduper(2), applied: string[] = [];
    let fail = true;
    await expect(consumeOnce([{ event: first }], deduper, e => { if (fail) throw new Error('transient'); applied.push(e.id); })).rejects.toThrow();
    fail = false;
    expect(await consumeOnce([{ event: first }, { event: first }, { event: second }, { event: second }], deduper, e => { applied.push(e.id); })).toBe(2);
    expect(applied).toEqual([first.id, second.id]);
    deduper.remember('third');
    expect(deduper.has(first.id)).toBe(false);
  });
});
