# 0003. Better Auth database sessions and tenant-specific Entra sign-in

- Status: Accepted
- Date: 2026-10-01
- Milestone: 07

## Context

The frontend is Vite/React, with Node-only Next.js Route Handlers behind the same public origin. The milestone 06 migration already contains Better Auth's core User, Session, Account and Verification models. Production passwords must not be implemented. Local teaching must work without identity-provider credentials.

## Decision

Pin Better Auth 1.7.7, verified against current official documentation and installed declarations/source. Its Prisma adapter owns durable sessions, signed HttpOnly cookies, authentication, OAuth state/nonce/PKCE, token verification and logout. The schema needed no new migration. Disable password auth and automatic account linking; the Microsoft provider binds identity to verified `oid` in one configured tenant. Email is display/contact metadata and never an ownership key. Strip profile images and encrypt provider tokens at rest through the library.

Use eight-hour absolute sessions with refresh and cookie caching disabled. Require a fresh signed-cookie library lookup plus current database lookup to mint the existing opaque owner repository context on each request. Logout deletes the database session; replayed cookies fail immediately. Production requires HTTPS, a persistent random secret of at least 32 characters, database URL, client ID/secret and a specific tenant UUID. Instrumentation validates config before serving requests. Build-time compilation can run without credentials; runtime cannot.

Local demo is explicitly enabled with DEMO_AUTH_ENABLED=true only in development/test and a loopback public origin. A library endpoint accepts only `alice` or `bob`, rejects extra properties, maps these aliases to two fixed seeded identities, and issues cookies with library helpers. It never accepts user IDs or emails. No password storage or credential seed is needed. Missing OIDC settings simply hide Microsoft sign-in locally. Without a local AUTH_SECRET, a random process secret invalidates sessions after restart; replicas/production must share a persistent secret.

Keep the library's documented exact trustedOrigins, SameSite=Lax and CSRF protections explicitly enabled, even under test. Add a fail-closed exact Origin requirement for all application/auth POSTs, including initial demo login. Requests without Origin are rejected; CLI clients must send the public origin. OAuth GET callbacks are the protocol exception and require library state/nonce validation. No CORS headers are added. Only auth options, sign-in, sign-out and Microsoft callback endpoints are exposed; raw library session/account/token APIs are not public. Health and the sign-in handshake are necessarily anonymous; every application data/AI route is authorized.

The protected frontend gate uses /api/me, displays the real session identity, unmounts private screens on expiry/logout and clears query caches. Its existing financial screens remain explicitly static fixtures until milestone 10. A read-only owner-scoped portfolio endpoint demonstrates safe 404 responses for both missing and foreign IDs; CRUD remains milestone 08.

## Alternatives considered

Auth.js was considered; its current Prisma guide installs next-auth@beta, and demo database sessions would require additional integration. Better Auth matches the pre-existing schema and has documented extension endpoints and Entra identity handling. Custom production password/session implementations were excluded by the project contract.

## Consequences

PostgreSQL is required even for demo sign-in. Entra needs an app registration and tenant-specific credentials. Application logout revokes PortfolioPilot access but does not end the Microsoft SSO session. Session cleanup scheduling, distributed rate limits and operational hardening remain later milestones. Owner repository contexts must never be cached or reused after requests.

## References

Official docs checked 2026-10-01, library 1.7.7:

- [Next.js integration](https://better-auth.com/docs/integrations/next)
- [Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [Microsoft provider and stable identity](https://better-auth.com/docs/authentication/microsoft)
- [Session management](https://better-auth.com/docs/concepts/session-management)
- [CSRF, trusted origins and OAuth state](https://better-auth.com/docs/reference/security)
- [Plugin endpoints and internal session adapter](https://better-auth.com/docs/concepts/plugins)
- Installed Next.js 16.3.8 `dist/docs/01-app/01-getting-started/15-route-handlers.md`, installed auth declarations and route/cookie/Microsoft implementations.
