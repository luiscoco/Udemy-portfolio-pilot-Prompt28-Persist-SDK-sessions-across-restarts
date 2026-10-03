import { errorEnvelopeSchema } from '@portfolio-pilot/contracts';

export type ApiFailureKind = 'http' | 'network' | 'timeout' | 'cancelled' | 'invalid-response';
export class ApiError extends Error {
  constructor(message: string, public readonly kind: ApiFailureKind, public readonly status?: number, public readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function apiRequest<T>(path: `/api/${string}`, schema: { parse(value: unknown): T }, options: ApiRequestOptions = {}): Promise<T> {
  const { signal, timeoutMs = 10000, ...init } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...init.headers } });
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('session-expired'));
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ApiError('The server returned an invalid JSON response.', 'invalid-response', response.status); }
    if (!response.ok) {
      const envelope = errorEnvelopeSchema.safeParse(body);
      throw new ApiError(envelope.success ? envelope.data.error.message : `Request failed (HTTP ${response.status}).`, 'http', response.status, envelope.success ? envelope.data.error.requestId : undefined);
    }
    try { return schema.parse(body); }
    catch { throw new ApiError('The server response did not match the expected format.', 'invalid-response', response.status); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError('The request timed out.', 'timeout');
    if (signal?.aborted) throw new ApiError('The request was cancelled.', 'cancelled');
    throw new ApiError('Could not connect to the server.', 'network');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
