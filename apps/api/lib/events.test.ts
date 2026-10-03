import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserEventSchema, type AppEvent } from '@portfolio-pilot/contracts';
import { EventHub, SSE_LIMITS } from './event-hub';
import { cursorCodec } from './event-cursor';
import { eventResponse } from './event-response';
import { publicEvent } from './browser-event';

const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const raw = (n: number) => `v1.${epoch}.${n}-0`;
const positions = { user: raw(1), market: raw(1) };
const codec = cursorCodec('test-secret');
const event = (owner = 'alice'): AppEvent => ({ id: randomUUID(), schemaVersion: 1, occurredAt: new Date().toISOString(), type: 'news.available',
  entityType: 'news_article', entityId: 'article', portfolioId: null, audience: { kind: 'user', userId: owner },
  payload: { change: 'new', securityIds: ['stock'], portfolioIds: ['portfolio'], watchlisted: true, sourceEventId: randomUUID() } });
afterEach(() => { vi.useRealTimers(); });
describe('authorized SSE cursors and public DTOs', () => {
  it('binds both positions to the owner and rejects tampering, malformed and oversized cursors', () => {
    const token = codec.encode('alice', positions);
    expect(codec.decode('alice', token)).toEqual(positions);
    expect(codec.decode('bob', token)).toBeNull();
    expect(codec.decode('alice', token + 'a')).toBeNull();
    expect(codec.decode('alice', 'x'.repeat(2049))).toBeNull();
    expect(codec.decode('alice', codec.encode('alice', { user: 'bad', market: raw(1) }))).toBeNull();
  });
  it('projects only public fields and refuses internal events and arbitrary agent details', () => {
    const dto = publicEvent(event());
    expect(dto).toMatchObject({ type: 'news.available', articleId: 'article' });
    expect(JSON.stringify(dto)).not.toMatch(/audience|sourceEventId|entityType|userId/);
    expect(browserEventSchema.safeParse({ ...dto, internal: 'secret' }).success).toBe(false);
    expect(publicEvent({ ...event(), entityType: 'news_article', type: 'news.article.ingested', audience: { kind: 'system' }, payload: { change: 'new', securityIds: [] } })).toBeNull();
    for (const type of ['agent.run.started', 'agent.text.delta', 'agent.block.completed', 'agent.tool.status', 'agent.message.completed', 'agent.run.completed']) {
      expect(browserEventSchema.safeParse({ ...event(), type, reasoning: 'secret' }).success).toBe(false);
    }
  });
});
describe('per-instance replay and local fan-out', () => {
  it('shares cohort reads, sends replay to every pod/client, suppresses duplicate publication, and advances cursors', async () => {
    vi.useFakeTimers();
    const e = event();
    const read = vi.fn(async (scope, cursor) => ({ status: 'ok' as const, cursor: scope.kind === 'user' ? raw(3) : cursor, skipped: 0,
      events: scope.kind === 'user' ? [{ cursor: raw(2), event: e }, { cursor: raw(3), event: e }] : [] }));
    const hub = new EventHub(read, codec), otherPod = new EventHub(read, codec);
    const a: string[] = [], b: string[] = [], c: string[] = [];
    const stops = [hub.subscribe('alice', positions, f => { a.push(f); return true; }, () => {}),
      hub.subscribe('alice', positions, f => { b.push(f); return true; }, () => {}),
      otherPod.subscribe('alice', positions, f => { c.push(f); return true; }, () => {})];
    await hub.tick(); await otherPod.tick();
    for (const frames of [a, b, c]) {
      expect(frames.join('')).toContain('event: news.available');
      expect(frames.filter(f => f.includes('event: news.available'))).toHaveLength(1);
      const lastId = frames.at(-1)!.split('\n')[0]!.slice(4);
      expect(codec.decode('alice', lastId)?.user).toBe(raw(3));
    }
    expect(read).toHaveBeenCalledTimes(4); // user+market once per independent pod
    stops.forEach(stop => stop()); expect(hub.size).toBe(0);
  });
  it('does not send another owner’s events; resets expired/gapped scopes and releases clients', async () => {
    vi.useFakeTimers();
    const frames: string[] = [], close = vi.fn();
    const hub = new EventHub(async scope => scope.kind === 'user' ? { status: 'ok', cursor: raw(2), skipped: 0,
      events: [{ cursor: raw(2), event: event('bob') }] } : { status: 'reset', reason: 'expired' }, codec);
    hub.subscribe('alice', positions, f => { frames.push(f); return true; }, close);
    await hub.tick();
    expect(frames.join('')).not.toContain('news.available'); expect(frames.join('')).toContain('stream.reset');
    expect(close).toHaveBeenCalledOnce(); expect(hub.size).toBe(0);
  });
});
describe('stream lifecycle', () => {
  it('sets SSE headers, emits heartbeat comments and cleans up on abort and reader cancellation', async () => {
    vi.useFakeTimers();
    const hub = new EventHub(async (_s, cursor) => ({ status: 'ok', cursor, events: [], skipped: 0 }), codec);
    const abort = new AbortController();
    const response = eventResponse(new Request('http://localhost/api/events', { signal: abort.signal }), 'alice', new Date(Date.now() + 60000), positions, hub, async () => true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-transform');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected');
    await vi.advanceTimersByTimeAsync(SSE_LIMITS.heartbeatMs);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': heartbeat\n\n');
    abort.abort(); expect(hub.size).toBe(0); expect((await reader.read()).done).toBe(true);
    const second = eventResponse(new Request('http://localhost/api/events'), 'alice', new Date(Date.now() + 60000), positions, hub, async () => true);
    await second.body!.cancel(); expect(hub.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('closes on revocation, expiry, revalidation timeout and slow-client overflow', async () => {
    vi.useFakeTimers();
    for (const revalidate of [async () => false, () => new Promise<boolean>(() => {})]) {
      const hub = new EventHub(async (_s, cursor) => ({ status: 'ok', cursor, events: [], skipped: 0 }), codec);
      const r = eventResponse(new Request('http://localhost/api/events'), 'alice', new Date(Date.now() + 60000), positions, hub, revalidate);
      await vi.advanceTimersByTimeAsync(SSE_LIMITS.revalidateMs + SSE_LIMITS.operationMs);
      expect(hub.size).toBe(0); await r.body!.cancel();
    }
    const hub = new EventHub(async (_s, cursor) => ({ status: 'ok', cursor, events: [], skipped: 0 }), codec);
    const r = eventResponse(new Request('http://localhost/api/events'), 'alice', new Date(Date.now() + 1000), positions, hub, async () => true);
    await vi.advanceTimersByTimeAsync(1000); expect(hub.size).toBe(0); await r.body!.cancel();
    const events = Array.from({ length: 100 }, (_, i) => {
      const e = event() as Extract<AppEvent, { type: 'news.available' }>;
      e.payload.securityIds = Array.from({ length: 30 }, (_, j) => `stock-${j}`);
      return { cursor: raw(i + 2), event: e };
    });
    const busy = new EventHub(async scope => ({ status: 'ok', cursor: raw(101), events: scope.kind === 'user' ? events : [], skipped: 0 }), codec);
    const slow = eventResponse(new Request('http://localhost/api/events'), 'alice', new Date(Date.now() + 60000), positions, busy, async () => true);
    await busy.tick(); expect(busy.size).toBe(0); await slow.body!.cancel();
  });
  it('sends a reset with no reusable ID for a fresh/foreign cursor and leaves no resources', async () => {
    const hub = new EventHub(async () => { throw new Error('should not read'); }, codec);
    const response = eventResponse(new Request('http://localhost/api/events'), 'alice', new Date(Date.now() + 60000), null, hub, async () => true, 'invalid_cursor');
    expect(await response.text()).toMatch(/^id:\nevent: stream.reset/); expect(hub.size).toBe(0);
  });
});
