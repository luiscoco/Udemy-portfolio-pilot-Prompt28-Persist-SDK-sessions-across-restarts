import { describe, expect, it, vi } from 'vitest';
import { assertFixtureEnvironment, fixtureArticle, injectFixture } from '../src/fixture.js';
describe('development fixture injection', () => {
  const env = { NODE_ENV: 'development', DATA_MODE: 'mock', DATABASE_URL: 'postgresql://localhost/fixture_verify' };
  it('fails closed outside local development mock mode before repository access', async () => {
    for (const change of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: '' }, { DATA_MODE: 'live' }, { DATABASE_URL: 'postgresql://remote.example/db' }]) {
      const initialize = vi.fn();
      await expect(injectFixture({ initialize } as any, { id: 'test', revision: 1, publishedAt: '2026-10-02T10:00:00.000Z' }, { ...env, ...change })).rejects.toThrow();
      expect(initialize).not.toHaveBeenCalled();
    }
    expect(() => assertFixtureEnvironment(env)).not.toThrow();
  });
  it('preserves identity and publication across repeat injection and correction', () => {
    const first = fixtureArticle('acceptance', 1, '2026-10-02T10:00:00.000Z');
    const corrected = fixtureArticle('acceptance', 2, first.publishedAt);
    expect(corrected.sourceRecordId).toBe(first.sourceRecordId);
    expect(corrected.canonicalUrl).toBe(first.canonicalUrl);
    expect(corrected.publishedAt).toBe(first.publishedAt);
    expect(Date.parse(corrected.providerAt)).toBeGreaterThan(Date.parse(first.providerAt));
    expect(corrected.symbols).toEqual(['NOVA']);
  });
});
