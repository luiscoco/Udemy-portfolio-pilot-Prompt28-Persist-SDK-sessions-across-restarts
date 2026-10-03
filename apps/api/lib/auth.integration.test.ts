import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDatabase, closeConnections } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { createAuthentication } from './auth';
import { GET as me } from '../app/api/me/route';
import { GET as portfolio } from '../app/api/portfolios/[id]/route';
import { POST as ask } from '../app/api/conversations/route';
import { GET as authGet, POST as authPost } from '../app/api/auth/[...all]/route';
import { GET as market } from '../app/api/market/route';

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = 'http://localhost:5173';
const req = (path: string, cookie = '', body?: unknown, requestOrigin = origin) => new Request(`${origin}/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
describe.skipIf(!databaseUrl)('real PostgreSQL authentication acceptance', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let alice = ''; let bob = '';
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/portfolio_m07_auth_verify') throw new Error('Use the dedicated local authentication verification database.');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', databaseUrl!); vi.stubEnv('DATA_MODE', 'mock');
    vi.stubEnv('DEMO_AUTH_ENABLED', 'true'); vi.stubEnv('AUTH_BASE_URL', origin);
    vi.stubEnv('AUTH_SECRET', 'local-verification-secret-only-1234567890');
    db = await getDatabase(databaseUrl!); await seedDemo(db);
  });
  afterAll(async () => { vi.unstubAllEnvs(); await closeConnections(); });
  it('rejects anonymous requests and unknown auth endpoints', async () => {
    expect((await me(req('me'))).status).toBe(401);
    expect((await portfolio(req('portfolios/demo-growth'), { params: Promise.resolve({ id: 'demo-growth' }) })).status).toBe(401);
    expect((await ask(req('conversations', '', { title: 'Research' }))).status).toBe(401);
    expect((await authGet(req('auth/get-session'))).status).toBe(404);
  });
  it('rejects first-login CSRF and arbitrary identity input', async () => {
    expect((await authPost(req('auth/demo-sign-in', '', { account: 'alice' }, 'https://evil.example'))).status).toBe(403);
    expect((await authPost(req('auth/demo-sign-in', '', { account: 'alice', userId: 'demo-bob' }))).status).toBe(400);
    expect((await authPost(req('auth/demo-sign-in', '', { account: 'admin' }))).status).toBe(400);
  });
  it('issues HttpOnly SameSite database sessions for two fixed accounts', async () => {
    for (const account of ['alice', 'bob']) {
      const response = await authPost(req('auth/demo-sign-in', '', { account }));
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find(c => c.startsWith('better-auth.session_token='))!;
      expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i);
      expect(await response.json()).toEqual({ ok: true });
      if (account === 'alice') alice = cookie.split(';')[0]!; else bob = cookie.split(';')[0]!;
      const identity = await me(req('me', cookie.split(';')[0]));
      expect(identity.status).toBe(200);
      expect(await identity.json()).toMatchObject({ user: { id: `demo-${account}` } });
      expect(identity.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('authenticates market snapshots and never substitutes mocks for unavailable live data', async () => {
    expect((await market(req('market'))).status).toBe(401);
    const mock = await market(req('market', alice));
    expect(mock.status).toBe(200); expect(mock.headers.get('cache-control')).toBe('no-store');
    expect(await mock.json()).toMatchObject({ mode: 'mock', status: 'fresh', quotes: [{ currency: 'USD', isSynthetic: true }, { currency: 'USD', isSynthetic: true }] });
    vi.stubEnv('DATA_MODE', 'live'); vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    try {
      const live = await market(req('market', alice)); expect(live.status).toBe(200);
      expect(await live.json()).toMatchObject({ mode: 'live', status: 'unavailable', error: 'not_configured', quotes: [], articles: [], fetchedAt: null });
    } finally { vi.stubEnv('DATA_MODE', 'mock'); }
  });
  it('isolates both owners and uses identical safe errors for missing and foreign resources', async () => {
    for (const [cookie, own, foreign] of [[alice, 'demo-growth', 'demo-bob-core'], [bob, 'demo-bob-core', 'demo-growth']]) {
      expect((await portfolio(req(`portfolios/${own}`, cookie), { params: Promise.resolve({ id: own! }) })).status).toBe(200);
      for (const id of [foreign!, 'missing']) {
        const response = await portfolio(req(`portfolios/${id}`, cookie), { params: Promise.resolve({ id }) });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ error: { message: 'Resource not found.' } });
      }
    }
  });
  it('blocks forged authenticated mutations without revoking the legitimate session', async () => {
    expect((await authPost(req('auth/sign-out', alice, {}, 'https://evil.example'))).status).toBe(403);
    expect((await ask(req('conversations', alice, { title: 'Research' }, 'https://evil.example'))).status).toBe(403);
    expect((await me(req('me', alice))).status).toBe(200);
  });
  it('revokes logout immediately even when the old cookie is replayed', async () => {
    expect((await authPost(req('auth/sign-out', alice, {}))).status).toBe(200);
    expect((await me(req('me', alice))).status).toBe(401);
    expect((await me(req('me', bob))).status).toBe(200);
  });
  it('rejects expired database sessions and altered signatures', async () => {
    await db.session.updateMany({ where: { userId: 'demo-bob' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(req('me', bob))).status).toBe(401);
    expect((await me(req('me', `${bob}x`))).status).toBe(401);
  });
  it('keeps demo absent and Secure cookies enabled in production configuration', async () => {
    const production = createAuthentication(db, { DATA_MODE: 'mock', NODE_ENV: 'production', DATABASE_URL: databaseUrl!, AUTH_BASE_URL: 'https://portfolio.example', AUTH_SECRET: 'local-verification-secret-only-1234567890', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'fixture-secret', ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111' });
    const context = await production.$context;
    expect(context.authCookies.sessionToken.attributes.secure).toBe(true);
    expect(context.authCookies.sessionToken.attributes.httpOnly).toBe(true);
    expect(context.options.plugins).toEqual([]);
    expect(context.options.account?.accountLinking?.enabled).toBe(false);
    expect(context.options.socialProviders?.microsoft).toMatchObject({ tenantId: '11111111-1111-4111-8111-111111111111' });
    const untrusted = await production.handler(new Request('https://portfolio.example/api/auth/sign-out', {
      method: 'POST', headers: { origin: 'https://evil.example', cookie: alice, 'content-type': 'application/json' }, body: '{}'
    }));
    expect(untrusted.status).toBe(403);
    const request = (path: string, body?: unknown) => new Request(`https://portfolio.example/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://portfolio.example', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const start = await production.handler(request('sign-in/social', { provider: 'microsoft', callbackURL: '/' }));
    expect(start.status).toBe(200);
    const authorize = new URL((await start.json()).url);
    expect(authorize.origin).toBe('https://login.microsoftonline.com');
    expect(authorize.pathname).toContain('11111111-1111-4111-8111-111111111111');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://portfolio.example/api/auth/callback/microsoft');
    expect(authorize.searchParams.get('state')).toBeTruthy();
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorize.searchParams.get('scope')).toContain('openid');
    expect(start.headers.getSetCookie().some(c => /Secure/i.test(c))).toBe(true);
    const foreign = await production.handler(request('sign-in/social', { provider: 'microsoft', callbackURL: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    const callback = await production.handler(request('callback/microsoft?code=forged&state=forged'));
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain('error=');
  });
});
