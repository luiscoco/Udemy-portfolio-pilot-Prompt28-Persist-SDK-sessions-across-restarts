import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeConnections, currentCursor, getDatabase, getRedis, publishEvent, readEvents, redisKeys } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { GET as events } from '../app/api/events/route';
import { GET as recovery } from '../app/api/events/recovery/route';
import { POST as authPost } from '../app/api/auth/[...all]/route';
import { cursorCodec } from './event-cursor';
import { EventHub } from './event-hub';

const databaseUrl = process.env.SSE_TEST_DATABASE_URL, redisUrl = process.env.SSE_TEST_REDIS_URL;
const origin = 'http://localhost:5173';
const keys = redisKeys(`sse-test-${randomUUID().slice(0, 12)}`);
const request = (path: string, cookie = '', body?: unknown) => new Request(`${origin}/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
describe.skipIf(!databaseUrl || !redisUrl)('real PostgreSQL session and Redis SSE acceptance', () => {
  let redis: Awaited<ReturnType<typeof getRedis>>, alice = '', bob = '';
  beforeAll(async () => {
    if (new URL(databaseUrl!).hostname !== '127.0.0.1' || new URL(databaseUrl!).pathname !== '/portfolio_m14_verify' || new URL(redisUrl!).hostname !== '127.0.0.1') throw new Error('Use loopback portfolio_m14_verify and Redis');
    vi.stubEnv('DATABASE_URL', databaseUrl!); vi.stubEnv('REDIS_URL', redisUrl!); vi.stubEnv('DATA_MODE', 'mock');
    vi.stubEnv('AUTH_BASE_URL', origin); vi.stubEnv('AUTH_SECRET', 'local-sse-verification-only-1234567890'); vi.stubEnv('DEMO_AUTH_ENABLED', 'true');
    await seedDemo(await getDatabase(databaseUrl!)); redis = await getRedis(redisUrl!);
    for (const account of ['alice', 'bob']) {
      const response = await authPost(request('auth/demo-sign-in', '', { account }));
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find(c => c.startsWith('better-auth.session_token='))!.split(';')[0]!;
      if (account === 'alice') alice = cookie; else bob = cookie;
    }
  });
  afterAll(async () => {
    if (redis) for await (const batch of redis.scanIterator({ MATCH: `${keys.prefix}:*`, COUNT: 100 })) if (batch.length) await redis.del(batch);
    await closeConnections(); vi.unstubAllEnvs();
  });
  it('uses real cookie sessions, signs snapshot positions, resets foreign cursors and rejects revoked cookies', async () => {
    expect((await events(request('events'))).status).toBe(401);
    const snapshotResponse = await recovery(request('events/recovery', alice));
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json();
    expect(cursorCodec().decode('demo-alice', snapshot.cursor)).toEqual(snapshot.streams);
    expect(await (await events(request(`events?cursor=${snapshot.cursor}`, bob))).text()).toContain('invalid_cursor');
    const response = await events(request(`events?cursor=${snapshot.cursor}`, alice));
    const reader = response.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected'); await reader.cancel();
    expect((await authPost(request('auth/sign-out', alice, {}))).status).toBe(200);
    expect((await events(request(`events?cursor=${snapshot.cursor}`, alice))).status).toBe(401);
  });
  it('replays Redis publications independently to two API hubs and two clients, once per UUID', async () => {
    const user = await currentCursor(redis, keys, { kind: 'user', userId: 'demo-alice' });
    const market = await currentCursor(redis, keys, { kind: 'market' });
    const event = { id: randomUUID(), schemaVersion: 1 as const, occurredAt: new Date().toISOString(), type: 'portfolio.updated' as const,
      entityType: 'portfolio' as const, entityId: 'demo-growth', portfolioId: 'demo-growth', audience: { kind: 'user' as const, userId: 'demo-alice' }, payload: { change: 'renamed' as const, transactionId: null } };
    await publishEvent(redis, keys, event); await publishEvent(redis, keys, event);
    const read = (scope: Parameters<typeof readEvents>[2], cursor: string) => readEvents(redis, keys, scope, cursor);
    const a = new EventHub(read), b = new EventHub(read), frames: string[][] = [[], [], []];
    const stops = [a.subscribe('demo-alice', { user, market }, f => { frames[0]!.push(f); return true; }, () => {}),
      a.subscribe('demo-alice', { user, market }, f => { frames[1]!.push(f); return true; }, () => {}),
      b.subscribe('demo-alice', { user, market }, f => { frames[2]!.push(f); return true; }, () => {})];
    try { await Promise.all([a.tick(), b.tick()]); for (const client of frames) expect(client.filter(f => f.includes('event: portfolio.updated'))).toHaveLength(1); }
    finally { stops.forEach(stop => stop()); }
    const expired = `v1.${user.split('.')[1]}.1-0`;
    expect(await readEvents(redis, keys, { kind: 'user', userId: 'demo-alice' }, expired)).toMatchObject({ status: 'reset', reason: 'expired' });
  });
});
