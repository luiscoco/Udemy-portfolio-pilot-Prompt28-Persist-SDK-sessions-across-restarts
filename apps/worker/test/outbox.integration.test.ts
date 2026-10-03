import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendEvent, authenticateOwner, closeConnections, consumeOnce, createCache, currentCursor, encodeCursor, EventDeduper, getDatabase, getRedis,
  newsReads, outboxRepository, portfolioService, publishEvent, quoteReads, readEvents, recoverySnapshot, redisKeys, STREAM_RETENTION,
  watchlistService, type AuthenticatedOwner, type ClaimedEvent, type RedisClient
} from '@portfolio-pilot/db';
import { dispatchOnce } from '../src/outbox.js';

const databaseUrl = process.env.OUTBOX_TEST_DATABASE_URL;
const redisUrl = process.env.OUTBOX_TEST_REDIS_URL;
for (const value of [databaseUrl, redisUrl]) if (value) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use loopback PostgreSQL and Redis for outbox acceptance');
}
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith('_verify')) throw new Error('Use a disposable *_verify database');

type Db = Awaited<ReturnType<typeof getDatabase>>;
type Publishable = NonNullable<ClaimedEvent['event']>;
const run = randomBytes(4).toString('hex');
const namespace = `pp-test-${run}`;
const keys = redisKeys(namespace);
const options = { owner: 'dispatcher', batchSize: 50, leaseMs: 30000, maxAttempts: 3, random: () => 1 };
const trade = (symbol: string, side: 'BUY' | 'SELL', quantity: string) => ({ security: { symbol, exchangeMic: 'XNAS', currency: 'USD' }, side, quantity, price: '100', fees: '0', occurredAt: '2026-10-01T12:00:00.000Z' });

let db: Db, redis: RedisClient;
let alice: { id: string; owner: AuthenticatedOwner }, bob: { id: string; owner: AuthenticatedOwner };
let held: { id: string; symbol: string }, watched: { id: string; symbol: string };
const articleIds: string[] = [];
const publish = (event: Publishable) => publishEvent(redis, keys, event);
async function drain() {
  for (let i = 0; i < 20; i++) if (!(await dispatchOnce(outboxRepository(db), publish, options)).claimed) return;
  throw new Error('outbox did not drain');
}
const userEvents = (userId: string) => db.outboxEvent.findMany({ where: { ownerId: userId }, orderBy: { sequence: 'asc' } });
async function streamEvents(userId: string) {
  const entries = await redis.xRange(keys.userStream(userId), '-', '+');
  return entries.map(entry => ({ entryId: String(entry.id), eventId: String(entry.message.eventId), envelope: JSON.parse(String(entry.message.envelope)) as Publishable }));
}
async function createUser(label: string) {
  const user = await db.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@outbox.verify.invalid` } });
  const token = randomUUID();
  await db.session.create({ data: { token, userId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
  return { id: user.id, owner: await authenticateOwner(db, token) };
}
async function createArticle(securityId: string, label: string) {
  const article = await db.newsArticle.create({ data: { provider: namespace, providerArticleId: label, title: `${label} headline`, summary: 'Synthetic acceptance article', url: `https://news.verify.invalid/${run}/${label}`, publishedAt: new Date('2026-09-30T12:00:00.000Z'), isSynthetic: true,
    securities: { create: [{ securityId }] } } });
  articleIds.push(article.id);
  return article;
}

describe.skipIf(!databaseUrl || !redisUrl)('PostgreSQL + Redis outbox, streams and cache acceptance', () => {
  beforeAll(async () => {
    db = await getDatabase(databaseUrl!); redis = await getRedis(redisUrl!);
    // Settle rows left PENDING by an earlier interrupted run so this run only sees its own events.
    await drain();
    alice = await createUser('alice'); bob = await createUser('bob');
    held = await db.security.create({ data: { symbol: `H${run.toUpperCase()}`, exchangeMic: 'XNAS', name: `held ${run}` } });
    watched = await db.security.create({ data: { symbol: `W${run.toUpperCase()}`, exchangeMic: 'XNAS', name: `watched ${run}` } });
  });
  afterAll(async () => {
    if (db) {
      await db.outboxEvent.deleteMany({ where: { OR: [{ entityId: { in: articleIds } }, { entityId: { startsWith: namespace } }] } });
      await db.newsArticle.deleteMany({ where: { provider: namespace } });
      await db.user.deleteMany({ where: { email: { endsWith: `-${run}@outbox.verify.invalid` } } });
      await db.quoteSnapshot.deleteMany({ where: { securityId: { in: [held?.id, watched?.id].filter(Boolean) as string[] } } });
      await db.security.deleteMany({ where: { id: { in: [held?.id, watched?.id].filter(Boolean) as string[] } } });
    }
    if (redis) for await (const batch of redis.scanIterator({ MATCH: `${namespace}:*`, COUNT: 500 })) if (batch.length) await redis.del(batch);
    await closeConnections();
  });

  it('commits events atomically with domain changes and rolls both back together', async () => {
    const portfolios = portfolioService(db, alice.owner);
    const portfolio = await portfolios.create({ name: `Outbox ${run}` });
    const { transaction } = await portfolios.record(portfolio.id, trade(held.symbol, 'BUY', '10'), `buy-${run}`);
    let events = await userEvents(alice.id);
    expect(events.map(e => (e.payload as { change: string }).change)).toEqual(['created', 'transaction.recorded']);
    expect(events[1]).toMatchObject({ type: 'portfolio.updated', schemaVersion: 1, audience: 'user', portfolioId: portfolio.id, entityId: portfolio.id, status: 'PENDING' });
    expect((events[1]!.payload as { transactionId: string }).transactionId).toBe(transaction.id);
    // The oversell inserts the trade and its event, then fails validation: both disappear.
    await expect(portfolios.record(portfolio.id, trade(held.symbol, 'SELL', '11'), `oversell-${run}`)).rejects.toThrow('oversell');
    // An idempotent replay returns the original result without a second event.
    expect((await portfolios.record(portfolio.id, trade(held.symbol, 'BUY', '10'), `buy-${run}`)).replayed).toBe(true);
    // An arbitrary failure after appendEvent in the same transaction also leaves nothing behind.
    await expect(db.$transaction(async tx => {
      await appendEvent(tx, { type: 'portfolio.updated', audience: { kind: 'user', userId: alice.id }, entityType: 'portfolio', entityId: portfolio.id, portfolioId: portfolio.id, payload: { change: 'renamed', transactionId: null } });
      throw new Error('simulated failure after the outbox insert');
    })).rejects.toThrow('simulated');
    events = await userEvents(alice.id);
    expect(events).toHaveLength(2);
    expect(await db.portfolioTransaction.count({ where: { portfolioId: portfolio.id } })).toBe(1);
    // Duplicate watchlist adds are idempotent and emit one event.
    await Promise.all([watchlistService(db, bob.owner).add({ securityId: watched.id }), watchlistService(db, bob.owner).add({ securityId: watched.id })]);
    expect((await userEvents(bob.id)).filter(e => e.type === 'watchlist.updated')).toHaveLength(1);
  });

  it('publishes to owner-only streams with cursors separate from stable event UUIDs', async () => {
    await drain();
    const published = await db.outboxEvent.findMany({ where: { ownerId: { in: [alice.id, bob.id] } } });
    expect(published.every(e => e.status === 'PUBLISHED' && e.publishedAt && e.streamEntryId && e.streamEntryId !== e.id)).toBe(true);
    const aliceStream = await streamEvents(alice.id), bobStream = await streamEvents(bob.id);
    expect(aliceStream.map(e => e.eventId).sort()).toEqual(published.filter(e => e.ownerId === alice.id).map(e => e.id).sort());
    expect(aliceStream.every(e => e.envelope.audience.kind === 'user' && e.envelope.audience.userId === alice.id)).toBe(true);
    expect(bobStream.some(e => aliceStream.some(a => a.eventId === e.eventId))).toBe(false);
    // Owner events bumped the owner's cache generation before reaching the stream.
    expect(Number(await redis.get(keys.userGeneration(alice.id)))).toBeGreaterThanOrEqual(2);
    expect(await redis.pTTL(keys.userStream(alice.id))).toBeGreaterThan(STREAM_RETENTION.idleExpiryMs - 60000);
  });

  it('retries failed publishes with backoff, bounds attempts and requeues dead events', async () => {
    const repository = outboxRepository(db);
    await portfolioService(db, alice.owner).create({ name: `Retry ${run}` });
    let failures = 0;
    const flaky = async (event: Publishable) => { if (failures++ < 1) throw new Error('connect ECONNREFUSED redis://default:hunter2@127.0.0.1:6379'); return publish(event); };
    expect(await dispatchOnce(repository, flaky, options)).toMatchObject({ claimed: 1, retried: 1, published: 0 });
    const retried = (await userEvents(alice.id)).at(-1)!;
    expect(retried).toMatchObject({ status: 'PENDING', attempts: 1, leaseOwner: null, claimToken: null });
    expect(retried.lastError).toContain('<url>');
    expect(retried.lastError).not.toContain('hunter2');
    expect(retried.availableAt.getTime()).toBeGreaterThan(Date.now() + 500);
    expect((await dispatchOnce(repository, flaky, options)).claimed).toBe(0);
    await db.outboxEvent.update({ where: { id: retried.id }, data: { availableAt: new Date(0) } });
    expect(await dispatchOnce(repository, flaky, options)).toMatchObject({ claimed: 1, published: 1 });
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: retried.id } })).attempts).toBe(2);
    // A permanently failing publisher exhausts the bounded budget and parks the event as DEAD.
    await portfolioService(db, alice.owner).create({ name: `Dead ${run}` });
    const broken = async () => { throw new Error('stream unavailable'); };
    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      await db.outboxEvent.updateMany({ where: { ownerId: alice.id, status: 'PENDING' }, data: { availableAt: new Date(0) } });
      await dispatchOnce(repository, broken, options);
    }
    const dead = (await userEvents(alice.id)).at(-1)!;
    expect(dead).toMatchObject({ status: 'DEAD', attempts: 3, lastError: 'Error: stream unavailable' });
    await db.outboxEvent.updateMany({ where: { id: dead.id }, data: { availableAt: new Date(0) } });
    expect((await dispatchOnce(repository, broken, options)).claimed).toBe(0);
    expect(await repository.requeueDead(dead.id)).toBe(true);
    expect(await dispatchOnce(repository, publish, options)).toMatchObject({ claimed: 1, published: 1 });
    expect((await streamEvents(alice.id)).filter(e => e.eventId === dead.id)).toHaveLength(1);
  });

  it('republishes after a crash between publish and acknowledgement; consumers apply the event once', async () => {
    const repository = outboxRepository(db);
    const deduper = new EventDeduper(), applied: string[] = [];
    const before = await currentCursor(redis, keys, { kind: 'user', userId: alice.id });
    await portfolioService(db, alice.owner).create({ name: `Crash ${run}` });
    const [crashed] = await repository.claim('crashing-dispatcher', { limit: 50 });
    expect(crashed?.event).toBeTruthy();
    // Concurrent dispatcher replicas claim disjoint rows (SKIP LOCKED + active lease).
    expect(await repository.claim('replica', { limit: 50 })).toHaveLength(0);
    const first = await publish(crashed!.event!);
    // ...process dies here. The lease expires and another dispatcher takes over.
    await db.outboxEvent.update({ where: { id: crashed!.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    expect(await dispatchOnce(repository, publish, { ...options, owner: 'replacement' })).toMatchObject({ claimed: 1, published: 1 });
    // The late acknowledgement from the dead dispatcher is fenced by its stale claim token.
    expect(await repository.markPublished(crashed!, first)).toBe(false);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id: crashed!.id } });
    expect(row.status).toBe('PUBLISHED');
    expect(row.streamEntryId).not.toBe(first.entryId);
    const read = await readEvents(redis, keys, { kind: 'user', userId: alice.id }, before);
    if (read.status !== 'ok') throw new Error(read.reason);
    const copies = read.events.filter(e => e.event.id === crashed!.id);
    expect(copies).toHaveLength(2);
    expect(copies[0]!.cursor).not.toBe(copies[1]!.cursor);
    expect(await consumeOnce(read.events, deduper, event => { applied.push(event.id); })).toBe(1);
    expect(await consumeOnce(read.events, deduper, event => { applied.push(event.id); })).toBe(0);
    expect(applied).toEqual([crashed!.id]);
  });

  it('fans global article ingestion out to owner-authorized notifications idempotently', async () => {
    const repository = outboxRepository(db);
    // Bob also held the security, but in a portfolio he archived: archived portfolios are not interested.
    const bobs = portfolioService(db, bob.owner);
    const archived = await bobs.create({ name: `Archived ${run}` });
    await bobs.record(archived.id, trade(held.symbol, 'BUY', '1'), `bob-${run}`);
    await bobs.archive(archived.id);
    await drain();
    const heldArticle = await createArticle(held.id, 'held'), watchedArticle = await createArticle(watched.id, 'watched');
    const sources = await db.$transaction(async tx => Promise.all([
      appendEvent(tx, { type: 'news.article.ingested', audience: { kind: 'system' }, entityType: 'news_article', entityId: heldArticle.id, portfolioId: null, payload: { change: 'new', securityIds: [held.id] } }),
      appendEvent(tx, { type: 'news.article.ingested', audience: { kind: 'system' }, entityType: 'news_article', entityId: watchedArticle.id, portfolioId: null, payload: { change: 'correction', securityIds: [watched.id] } })
    ]));
    expect((await dispatchOnce(repository, publish, options)).fannedOut).toBe(2);
    const notifications = await db.outboxEvent.findMany({ where: { type: 'news.available', entityId: { in: [heldArticle.id, watchedArticle.id] } } });
    const alicePortfolio = (await portfolioService(db, alice.owner).list()).find(p => p.name === `Outbox ${run}`)!;
    expect(notifications.map(n => [n.ownerId, n.entityId, n.payload]).sort()).toEqual([
      [alice.id, heldArticle.id, { change: 'new', securityIds: [held.id], portfolioIds: [alicePortfolio.id], watchlisted: false, sourceEventId: sources[0].id }],
      [bob.id, watchedArticle.id, { change: 'correction', securityIds: [watched.id], portfolioIds: [], watchlisted: true, sourceEventId: sources[1].id }]
    ].sort());
    // Redeliver the source event (e.g. crash before its acknowledgement): deterministic IDs prevent duplicates.
    await db.outboxEvent.update({ where: { id: sources[0].id }, data: { status: 'PENDING', publishedAt: null, availableAt: new Date(0) } });
    expect((await dispatchOnce(repository, publish, options)).fannedOut).toBe(1);
    expect(await db.outboxEvent.count({ where: { type: 'news.available', entityId: heldArticle.id } })).toBe(1);
    await drain();
    // Notifications reach only their owner's stream; system events never reach Redis.
    expect((await streamEvents(alice.id)).filter(e => e.envelope.entityId === heldArticle.id).map(e => e.envelope.type)).toEqual(['news.available']);
    expect((await streamEvents(bob.id)).some(e => e.envelope.entityId === heldArticle.id)).toBe(false);
    expect((await redis.xRange(keys.marketStream, '-', '+')).some(e => String(e.message.type) === 'news.article.ingested')).toBe(false);
  });

  it('publishes market quote events without user data and invalidates quote cache keys', async () => {
    const cache = createCache({ redis: async () => redis, namespace, random: () => 0.5 });
    await db.quoteSnapshot.create({ data: { securityId: held.id, provider: namespace, asOf: new Date('2026-09-30T12:00:00.000Z'), price: '101.25', isSynthetic: true } });
    const first = await quoteReads(db, cache).latest([held.id, watched.id]);
    expect(first.quotes.map(q => q.price)).toEqual(['101.25']);
    expect(first.missing).toEqual([watched.id]);
    const ttl = await redis.pTTL(keys.quoteLatest(held.id));
    expect(ttl).toBeGreaterThan(14000); expect(ttl).toBeLessThanOrEqual(15000);
    const negative = await redis.pTTL(keys.quoteLatest(watched.id));
    expect(negative).toBeGreaterThan(4000); expect(negative).toBeLessThanOrEqual(5000);
    await db.quoteSnapshot.create({ data: { securityId: held.id, provider: namespace, asOf: new Date('2026-09-30T12:00:30.000Z'), price: '102.50', isSynthetic: true } });
    expect((await quoteReads(db, cache).latest([held.id])).quotes[0]!.price).toBe('101.25');
    await db.$transaction(tx => appendEvent(tx, { type: 'quote.updated', audience: { kind: 'market' }, entityType: 'quote_batch', entityId: `${namespace}:quotes`, portfolioId: null, payload: { quotes: [{ securityId: held.id, asOf: '2026-09-30T12:00:30.000Z' }] } }));
    await drain();
    expect((await quoteReads(db, cache).latest([held.id])).quotes[0]!.price).toBe('102.5');
    const market = (await redis.xRange(keys.marketStream, '-', '+')).map(e => JSON.parse(String(e.message.envelope)));
    expect(market.length).toBeGreaterThan(0);
    for (const event of market) {
      expect(event.audience).toEqual({ kind: 'market' });
      expect(JSON.stringify(event)).not.toContain(alice.id);
      expect(JSON.stringify(event)).not.toContain(bob.id);
    }
  });

  it('serves owner-scoped cached news with single-flight across processes and event invalidation', async () => {
    let loads = 0;
    const cacheA = createCache({ redis: async () => redis, namespace }), cacheB = createCache({ redis: async () => redis, namespace });
    const slow = (cache: typeof cacheA) => cache.getOrLoad(keys.quoteLatest(`sf-${run}`), { ttlMs: 10000, jitterRatio: 0.2 }, { safeParse: (v: unknown) => ({ success: true as const, data: v as string }) },
      async () => { loads++; await new Promise(resolve => setTimeout(resolve, 150)); return 'loaded once'; });
    const results = await Promise.all([...Array.from({ length: 10 }, () => slow(cacheA)), ...Array.from({ length: 10 }, () => slow(cacheB))]);
    expect(results.every(r => r === 'loaded once')).toBe(true);
    expect(loads).toBe(1);
    expect(cacheA.stats.coalesced + cacheB.stats.coalesced).toBe(18);
    expect(cacheB.stats.waited + cacheA.stats.waited).toBe(1);

    const aliceNews = newsReads(db, cacheA, alice.owner), bobNews = newsReads(db, cacheA, bob.owner);
    const portfolio = (await portfolioService(db, alice.owner).list()).find(p => p.name === `Outbox ${run}`)!;
    const feed = await aliceNews.feed({ portfolioId: portfolio.id });
    expect(feed.articles.map(a => a.title)).toContain('held headline');
    const generation = await redis.get(keys.userGeneration(alice.id));
    expect(await redis.exists(`${keys.ownerNews(alice.id, generation!, portfolio.id, 20)}:m16`)).toBe(1);
    // Bob cannot read Alice's portfolio, cached or not, and his own feed has only his interests.
    await expect(bobNews.feed({ portfolioId: portfolio.id })).rejects.toThrow('Resource not found');
    expect((await bobNews.feed({})).articles.map(a => a.title)).toEqual(['watched headline']);
    // Cached until an owner event bumps the generation via the dispatcher.
    const loadsBefore = cacheA.stats.loads;
    await aliceNews.feed({ portfolioId: portfolio.id });
    expect(cacheA.stats.loads).toBe(loadsBefore);
    await watchlistService(db, alice.owner).add({ securityId: watched.id });
    await drain();
    expect((await aliceNews.feed({})).articles.map(a => a.title).sort()).toEqual(['held headline', 'watched headline']);
    expect(cacheA.stats.loads).toBe(loadsBefore + 1);
    // Redis outage: reads fall through to PostgreSQL.
    const down = createCache({ redis: async () => { throw new Error('down'); }, namespace });
    expect((await newsReads(db, down, alice.owner).feed({})).articles).toHaveLength(2);
  });

  it('bounds stream retention and resets expired, trimmed or foreign-epoch cursors to a snapshot', async () => {
    const scope = { kind: 'user' as const, userId: bob.id };
    const start = await currentCursor(redis, keys, scope);
    for (let i = 0; i < 3; i++) await watchlistService(db, bob.owner).edit((await watchlistService(db, bob.owner).list())[0]!.id, { securityId: i % 2 ? watched.id : held.id });
    await drain();
    const read = await readEvents(redis, keys, scope, start);
    if (read.status !== 'ok') throw new Error(read.reason);
    expect(read.events).toHaveLength(3);
    expect(await readEvents(redis, keys, scope, read.cursor)).toMatchObject({ status: 'ok', events: [] });
    // Trimming past a cursor creates a gap that cannot be replayed (Redis does not record trims in
    // max-deleted-entry-id, so this exercises the head-trim rule); a retained cursor still replays.
    await redis.xTrim(keys.userStream(bob.id), 'MAXLEN', 1);
    expect(await readEvents(redis, keys, scope, start)).toEqual({ status: 'reset', reason: 'trimmed' });
    expect(await readEvents(redis, keys, scope, read.events[0]!.cursor)).toEqual({ status: 'reset', reason: 'trimmed' });
    expect(await readEvents(redis, keys, scope, read.cursor)).toMatchObject({ status: 'ok', events: [] });
    // XDEL of an entry after the cursor is detected through max-deleted-entry-id.
    await watchlistService(db, bob.owner).edit((await watchlistService(db, bob.owner).list())[0]!.id, { securityId: watched.id });
    await watchlistService(db, bob.owner).edit((await watchlistService(db, bob.owner).list())[0]!.id, { securityId: held.id });
    await drain();
    const tail = (await streamEvents(bob.id)).slice(-2);
    await redis.xDel(keys.userStream(bob.id), tail[0]!.entryId);
    expect(await readEvents(redis, keys, scope, read.cursor)).toEqual({ status: 'reset', reason: 'trimmed' });
    const epoch = (await redis.get(keys.epoch))!;
    expect(await readEvents(redis, keys, scope, encodeCursor(epoch, `${Date.now() - STREAM_RETENTION.replayWindowMs - 60000}-0`))).toEqual({ status: 'reset', reason: 'expired' });
    expect(await readEvents(redis, keys, scope, 'not-a-cursor')).toEqual({ status: 'reset', reason: 'invalid_cursor' });
    // Redis data loss is detected through the epoch rather than by silently skipping entries.
    await redis.set(keys.epoch, randomUUID());
    expect(await readEvents(redis, keys, scope, read.cursor)).toEqual({ status: 'reset', reason: 'epoch_changed' });
    // Length bound: approximate MAXLEN trimming keeps an owner stream near its configured size.
    const event = (await streamEvents(bob.id))[0]!.envelope;
    for (let i = 0; i < STREAM_RETENTION.userStreamMaxEntries + 200; i++) await publish({ ...event, id: randomUUID() });
    const length = await redis.xLen(keys.userStream(bob.id));
    expect(length).toBeGreaterThanOrEqual(STREAM_RETENTION.userStreamMaxEntries);
    expect(length).toBeLessThan(STREAM_RETENTION.userStreamMaxEntries + 200);
  }, 60000);

  it('recovers with a race-free snapshot: cursor first, then owner state, then replay', async () => {
    const cache = createCache({ redis: async () => redis, namespace });
    await drain();
    const snapshot = await recoverySnapshot(db, redis, cache, alice.owner);
    expect(snapshot.portfolios.every(p => p.name.endsWith(run))).toBe(true);
    expect(snapshot.portfolios.map(p => p.name)).not.toContain(`Archived ${run}`);
    expect(snapshot.news.articles.map(a => a.title).sort()).toEqual(['held headline', 'watched headline']);
    // A change committed after the snapshot is replayed after the snapshot cursor; nothing earlier is.
    const later = await portfolioService(db, alice.owner).create({ name: `After snapshot ${run}` });
    await drain();
    const replay = await readEvents(redis, keys, { kind: 'user', userId: alice.id }, snapshot.streams.user!);
    if (replay.status !== 'ok') throw new Error(replay.reason);
    expect(replay.events.map(e => e.event.entityId)).toEqual([later.id]);
    // Without Redis the snapshot is still served, with no cursors.
    expect((await recoverySnapshot(db, null, createCache({ redis: async () => null, namespace }), alice.owner)).streams).toEqual({ user: null, market: null });
  });
});
