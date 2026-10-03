import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiRequest, ApiError } from './api-client';

const schema = z.object({ value: z.string() });
afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('parses a successful JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: 'ok' }), { status: 200 })));
    await expect(apiRequest('/api/example', schema)).resolves.toEqual({ value: 'ok' });
  });

  it('uses the shared error envelope', async () => {
    const requestId = '1427e142-18a5-4f4b-8a6d-8f285c06d0f8';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid request', requestId } }), { status: 400 })));
    await expect(apiRequest('/api/example', schema)).rejects.toMatchObject({ kind: 'http', status: 400, requestId, message: 'Invalid request' });
  });

  it('reports invalid response data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: 1 }), { status: 200 })));
    await expect(apiRequest('/api/example', schema)).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('distinguishes caller cancellation from timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_path, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const controller = new AbortController();
    const cancelled = apiRequest('/api/example', schema, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(apiRequest('/api/example', schema, { timeoutMs: 5 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(ApiError).toBeDefined();
  });
});
