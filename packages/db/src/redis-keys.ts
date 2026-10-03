import type { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

/**
 * Bump when a cached value or stream envelope changes shape. Old keys are then simply never read
 * again and expire by TTL; no flush or migration is needed.
 */
export const KEY_SCHEMA_VERSION = 'v1';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** IDs are embedded in keys, so reject separators/hash-tag braces instead of escaping them. */
export function safeKeyId(value: string): string {
  if (!SAFE_ID.test(value)) throw new Error('INVALID_KEY_ID');
  return value;
}

/**
 * Every Redis key PortfolioPilot uses. Owner keys carry the user ID inside a `{hash tag}` so a user's
 * stream, generation and cached reads share one cluster slot. Tests pass a unique namespace.
 */
export function redisKeys(namespace = 'pp') {
  if (!/^[a-z0-9-]{1,40}$/.test(namespace)) throw new Error('INVALID_NAMESPACE');
  const prefix = `${namespace}:${KEY_SCHEMA_VERSION}`;
  return {
    prefix,
    epoch: `${prefix}:events:epoch`,
    marketStream: `${prefix}:events:market`,
    userStream: (userId: string) => `${prefix}:events:user:{${safeKeyId(userId)}}`,
    userGeneration: (userId: string) => `${prefix}:cache:gen:user:{${safeKeyId(userId)}}`,
    quoteLatest: (securityId: string) => `${prefix}:cache:quote:latest:${safeKeyId(securityId)}`,
    ownerNews: (userId: string, generation: string, portfolioId: string | null, limit: number) =>
      `${prefix}:cache:news:user:{${safeKeyId(userId)}}:g${generation}:portfolio:${portfolioId === null ? '*all' : safeKeyId(portfolioId)}:limit:${limit}`
  };
}
export type RedisKeys = ReturnType<typeof redisKeys>;
