import { randomBytes } from 'node:crypto';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { getDatabase } from '@portfolio-pilot/db';
import { parseServerConfig } from '@portfolio-pilot/config/server';

// Generated once per development process. Set AUTH_SECRET for sessions across restarts.
const developmentSecret = randomBytes(32).toString('hex');
export function createAuthentication(db: Awaited<ReturnType<typeof getDatabase>>, env: NodeJS.ProcessEnv = process.env) {
  const config = parseServerConfig(env);
  const demoPlugin = {
    id: 'local-demo',
    endpoints: {
      demoSignIn: createAuthEndpoint('/demo-sign-in', {
        method: 'POST', body: z.object({ account: z.enum(['alice', 'bob']) }).strict()
      }, async ctx => {
        // No user ID, email, token or role is accepted from the caller.
        const id = ctx.body.account === 'alice' ? 'demo-alice' : 'demo-bob';
        const user = await ctx.context.internalAdapter.findUserById(id);
        if (!user) throw new APIError('NOT_FOUND', { message: 'Demo accounts have not been seeded.' });
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Sign-in unavailable.' });
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      })
    }
  } satisfies BetterAuthPlugin;
  return betterAuth({
    appName: 'PortfolioPilot',
    baseURL: config.AUTH_BASE_URL,
    secret: config.AUTH_SECRET ?? developmentSecret,
    database: prismaAdapter(db, { provider: 'postgresql' }),
    trustedOrigins: [config.AUTH_BASE_URL],
    emailAndPassword: { enabled: false },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 8 * 60 * 60, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: {
      // Explicitly retain protection even in the library's test environment.
      disableOriginCheck: false, disableCSRFCheck: false,
      useSecureCookies: config.NODE_ENV === 'production' || config.AUTH_BASE_URL.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' }
    },
    socialProviders: config.ENTRA_CLIENT_ID ? {
      microsoft: {
        clientId: config.ENTRA_CLIENT_ID, clientSecret: config.ENTRA_CLIENT_SECRET!,
        tenantId: config.ENTRA_TENANT_ID!, prompt: 'select_account',
        mapProfileToUser: () => ({ image: '' })
      }
    } : {},
    plugins: config.DEMO_AUTH_ENABLED ? [demoPlugin] : []
  });
}
let authentication: ReturnType<typeof createAuthentication> | undefined;
export async function getAuthentication() {
  if (!authentication) {
    const config = parseServerConfig(process.env);
    if (!config.DATABASE_URL) throw new Error('Database unavailable');
    authentication = createAuthentication(await getDatabase(config.DATABASE_URL));
  }
  return authentication;
}

/** Strict origin gate for every cookie mutation, including first sign-in. Library
 * CSRF/state/nonce checks remain enabled; this adds a fail-closed origin requirement. */
export function assertMutationOrigin(request: Request, baseURL = parseServerConfig(process.env).AUTH_BASE_URL) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('origin') !== baseURL || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new APIError('FORBIDDEN', { message: 'Untrusted request origin.' });
  }
}
