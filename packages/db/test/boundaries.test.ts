import { describe, expect, it } from 'vitest';
import { assertLocalSeed, fixtureClock } from '../src/seed.js';
import { authenticateOwner, ownerRepositories } from '../src/repositories.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
describe('database entry boundaries', () => {
  it('uses a stable clock and returns independent dates', () => {
    const date = fixtureClock.now();
    date.setUTCFullYear(2000);
    expect(fixtureClock.now().toISOString()).toBe('2025-01-15T16:00:00.000Z');
  });
  it('requires explicit local opt-in and rejects production', () => {
    const env = { NODE_ENV: 'test', ALLOW_DEMO_SEED: 'true', DATABASE_URL: 'postgresql://u:p@127.0.0.1/demo' };
    expect(() => assertLocalSeed(env)).not.toThrow();
    expect(() => assertLocalSeed({ ...env, NODE_ENV: 'production' })).toThrow();
    expect(() => assertLocalSeed({ ...env, ALLOW_DEMO_SEED: 'false' })).toThrow();
    expect(() => assertLocalSeed({ ...env, DATABASE_URL: 'postgresql://u:p@remote/demo' })).toThrow();
  });
  it('rejects fabricated contexts before accessing the database', () => {
    expect(() => ownerRepositories({} as PrismaClient, { userId: 'victim' } as never)).toThrow('UNAUTHORIZED');
  });
  it('rejects empty tokens before accessing the database', async () => {
    await expect(authenticateOwner({} as PrismaClient, '')).rejects.toThrow('UNAUTHORIZED');
  });
});
