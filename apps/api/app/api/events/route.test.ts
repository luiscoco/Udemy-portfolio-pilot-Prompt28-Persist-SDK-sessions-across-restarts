import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccessError, requireAuthorization } from '../../../lib/authorization';
import { cursorCodec } from '../../../lib/event-cursor';
import { EventHub } from '../../../lib/event-hub';
import { GET } from './route';

vi.mock('../../../lib/authorization', async importOriginal => ({ ...await importOriginal<typeof import('../../../lib/authorization')>(), requireAuthorization: vi.fn() }));
vi.mock('../../../lib/events', () => ({ eventHub: () => new EventHub(async (_scope, cursor) => ({ status: 'ok', cursor, events: [], skipped: 0 })) }));
const auth = { user: { id: 'alice' }, expiresAt: new Date(Date.now() + 60000) };
beforeEach(() => { vi.stubEnv('DATA_MODE', 'mock'); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it('rejects anonymous clients before opening a stream', async () => {
  vi.mocked(requireAuthorization).mockRejectedValue(new AccessError(401, 'Sign in to continue.'));
  expect((await GET(new Request('http://localhost/api/events'))).status).toBe(401);
});
it('rejects token/unknown query parameters and repeated cursors', async () => {
  vi.mocked(requireAuthorization).mockResolvedValue(auth as Awaited<ReturnType<typeof requireAuthorization>>);
  for (const query of ['access_token=secret', 'cursor=a&cursor=b', 'userId=bob']) {
    expect((await GET(new Request(`http://localhost/api/events?${query}`))).status).toBe(400);
  }
});
it('resets malformed and another user’s signed cursors to the authenticated snapshot endpoint', async () => {
  vi.mocked(requireAuthorization).mockResolvedValue(auth as Awaited<ReturnType<typeof requireAuthorization>>);
  const raw = 'v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.1-0';
  for (const cursor of ['malformed', cursorCodec().encode('bob', { user: raw, market: raw })]) {
    const response = await GET(new Request(`http://localhost/api/events?cursor=${cursor}`));
    expect(await response.text()).toContain('"recoveryUrl":"/api/events/recovery"');
  }
});
it('uses Last-Event-ID instead of the original EventSource query on reconnect', async () => {
  vi.mocked(requireAuthorization).mockResolvedValue(auth as Awaited<ReturnType<typeof requireAuthorization>>);
  const raw = 'v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.1-0';
  const cursor = cursorCodec().encode('alice', { user: raw, market: raw });
  const response = await GET(new Request('http://localhost/api/events?cursor=old', { headers: { 'Last-Event-ID': cursor } }));
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected');
  await reader.cancel();
});
