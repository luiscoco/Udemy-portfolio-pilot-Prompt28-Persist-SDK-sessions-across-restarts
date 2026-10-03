import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checks = vi.hoisted(() => ({ database: vi.fn(), redis: vi.fn() }));
vi.mock('@portfolio-pilot/db', () => ({ checkDatabase: checks.database, checkRedis: checks.redis }));
import { GET } from './route';

const prior = { database: process.env.DATABASE_URL, redis: process.env.REDIS_URL };
beforeEach(() => { vi.stubEnv('DATA_MODE', 'mock'); });
afterEach(() => {
  if (prior.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior.database;
  if (prior.redis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prior.redis;
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('readiness', () => {
  it('reports both dependencies without credentials', async () => {
    process.env.DATABASE_URL = 'postgresql://user:private@localhost:5432/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    checks.database.mockResolvedValue(true);
    checks.redis.mockResolvedValue(true);
    const response = await GET(new Request('http://localhost/api/health/ready'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', dependencies: { postgres: 'up', redis: 'up' } });
    expect(JSON.stringify(await GET(new Request('http://localhost/api/health/ready')).then((r) => r.json()))).not.toContain('private');
  });
  it('returns 503 when Redis stops', async () => {
    process.env.DATABASE_URL = 'postgresql://user:private@localhost:5432/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    checks.database.mockResolvedValue(true);
    checks.redis.mockResolvedValue(false);
    const response = await GET(new Request('http://localhost/api/health/ready'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'unavailable', dependencies: { postgres: 'up', redis: 'down' } });
  });
});
