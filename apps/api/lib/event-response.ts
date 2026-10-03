import { SSE_LIMITS, EventHub, bounded, resetFrame } from './event-hub';
import type { Positions } from './event-cursor';

export function eventResponse(request: Request, owner: string, expiresAt: Date, positions: Positions | null,
  hub: EventHub, revalidate: () => Promise<boolean>, resetReason: 'snapshot_required' | 'invalid_cursor' = 'snapshot_required'): Response {
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false, checking = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let validation: ReturnType<typeof setInterval> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        if (closed) return;
        closed = true; unsubscribe(); clearInterval(heartbeat); clearInterval(validation); clearTimeout(expiry);
        request.signal.removeEventListener('abort', close);
        // cancel() has already closed the Web stream before invoking our cleanup callback.
        try { controller.close(); } catch { /* already cancelled */ }
      };
      cleanup = close;
      const encoder = new TextEncoder();
      const send = (frame: string) => {
        if (closed) return false;
        const bytes = encoder.encode(frame);
        // Reserve room for a reset even when a single valid DTO is larger than the queue.
        if ((controller.desiredSize ?? 0) < bytes.byteLength + 512) {
          const reset = encoder.encode(resetFrame('slow_client'));
          if ((controller.desiredSize ?? 0) >= reset.byteLength) controller.enqueue(reset);
          close(); return false;
        }
        controller.enqueue(bytes); return true;
      };
      request.signal.addEventListener('abort', close, { once: true });
      if (request.signal.aborted || expiresAt.getTime() <= Date.now()) { close(); return; }
      if (!positions) { send(resetFrame(resetReason)); close(); return; }
      try { unsubscribe = hub.subscribe(owner, positions, send, close); }
      catch { send(resetFrame('unavailable')); close(); return; }
      send('retry: 3000\n: connected\n\n');
      heartbeat = setInterval(() => { send(': heartbeat\n\n'); }, SSE_LIMITS.heartbeatMs);
      expiry = setTimeout(close, Math.min(expiresAt.getTime() - Date.now(), 2147483647));
      validation = setInterval(() => {
        if (checking || closed) return;
        checking = true;
        void bounded(revalidate()).then(ok => { if (!ok) close(); }, close).finally(() => { checking = false; });
      }, SSE_LIMITS.revalidateMs);
    },
    cancel() { cleanup(); }
  }, { highWaterMark: SSE_LIMITS.bufferBytes, size: chunk => chunk.byteLength });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no', 'Vary': 'Cookie' } });
}
