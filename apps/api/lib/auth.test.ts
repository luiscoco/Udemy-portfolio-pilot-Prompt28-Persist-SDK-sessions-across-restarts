import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { assertMutationOrigin } from './auth';
afterEach(() => vi.unstubAllEnvs());
describe('authentication configuration and origin boundary', () => {
  it('requires explicit local opt-in and rejects production demo startup', () => {
    expect(parseServerConfig({ DATA_MODE: 'mock',}).DEMO_AUTH_ENABLED).toBe(false);
    expect(parseServerConfig({ DATA_MODE: 'mock', NODE_ENV: 'test', DEMO_AUTH_ENABLED: 'true' }).DEMO_AUTH_ENABLED).toBe(true);
    expect(() => parseServerConfig({ DATA_MODE: 'mock', NODE_ENV: 'production', DEMO_AUTH_ENABLED: 'true' })).toThrow();
    expect(() => parseServerConfig({ DATA_MODE: 'mock', DEMO_AUTH_ENABLED: 'true', AUTH_BASE_URL: 'https://example.com' })).toThrow();
  });
  it('validates complete tenant-specific production OIDC settings', () => {
    const config = { DATA_MODE: 'mock', NODE_ENV: 'production', AUTH_BASE_URL: 'https://portfolio.example', AUTH_SECRET: 'a'.repeat(40), DATABASE_URL: 'postgresql://localhost/db', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret', ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111' };
    expect(parseServerConfig(config).DEMO_AUTH_ENABLED).toBe(false);
    expect(() => parseServerConfig({ ...config, AUTH_BASE_URL: 'http://portfolio.example' })).toThrow();
    expect(() => parseServerConfig({ DATA_MODE: 'mock', ENTRA_CLIENT_ID: 'client' })).toThrow();
  });
  it('fails closed for missing, null, malformed and foreign mutation origins', () => {
    for (const origin of [undefined, 'null', 'http://localhost:9999', 'https://evil.example', 'invalid']) {
      const request = new Request('http://localhost:3001/api/auth/sign-out', { method: 'POST', headers: origin ? { origin } : {} });
      expect(() => assertMutationOrigin(request, 'http://localhost:5173')).toThrow();
    }
    expect(() => assertMutationOrigin(new Request('http://localhost:3001', { method: 'POST', headers: { origin: 'http://localhost:5173' } }), 'http://localhost:5173')).not.toThrow();
  });
});
