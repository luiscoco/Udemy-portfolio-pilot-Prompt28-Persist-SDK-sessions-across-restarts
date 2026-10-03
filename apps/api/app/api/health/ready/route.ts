import { parseServerConfig } from '@portfolio-pilot/config/server';
import { checkDatabase, checkRedis } from '@portfolio-pilot/db';
import { REQUEST_ID_HEADER } from '@portfolio-pilot/contracts';
import { getRequestId } from '../../../../lib/http';

export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  let postgres = false;
  let redis = false;
  try {
    const config = parseServerConfig(process.env);
    if (config.DATABASE_URL && config.REDIS_URL) {
      [postgres, redis] = await Promise.all([
        checkDatabase(config.DATABASE_URL),
        checkRedis(config.REDIS_URL)
      ]);
    }
  } catch { /* Invalid or missing configuration means not ready. */ }
  const ready = postgres && redis;
  return Response.json(
    { status: ready ? 'ready' : 'unavailable', dependencies: { postgres: postgres ? 'up' : 'down', redis: redis ? 'up' : 'down' }, requestId },
    { status: ready ? 200 : 503, headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } }
  );
}
