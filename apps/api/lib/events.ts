import { readEvents } from '@portfolio-pilot/db';
import { applicationCache, optionalRedis } from './cache';
import { EventHub, SSE_LIMITS } from './event-hub';

let hub: EventHub | undefined;
let connecting: ReturnType<typeof optionalRedis> | undefined;
async function streamRedis() {
  // Coalesce initial/reconnect attempts as well as reads: getRedis's established client is shared,
  // but simultaneous callers must not each open a candidate while the first is still connecting.
  const pending = connecting ??= optionalRedis();
  try { return await pending; } finally { if (connecting === pending) connecting = undefined; }
}
export function eventHub() {
  hub ??= new EventHub(async (scope, cursor) => {
    const redis = await streamRedis();
    if (!redis) throw new Error('STREAM_UNAVAILABLE');
    return readEvents(redis, applicationCache().keys, scope, cursor, SSE_LIMITS.batch);
  });
  return hub;
}
