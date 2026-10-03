import { createCache, getRedis, type Cache, type RedisClient } from '@portfolio-pilot/db';
import { parseServerConfig } from '@portfolio-pilot/config/server';

// One cache per API process so concurrent requests share in-process single-flight.
let cache: Cache | undefined;
/** Redis is optional for reads: without REDIS_URL every read goes to PostgreSQL. */
export async function optionalRedis(): Promise<RedisClient | null> {
  const url = parseServerConfig(process.env).REDIS_URL;
  return url ? getRedis(url) : null;
}
export function applicationCache(): Cache {
  cache ??= createCache({ redis: optionalRedis });
  return cache;
}
