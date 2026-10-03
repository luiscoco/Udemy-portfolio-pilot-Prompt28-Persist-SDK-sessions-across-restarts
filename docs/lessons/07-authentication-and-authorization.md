# 07 — Authentication and authorization

Authentication identifies the caller. Authorization scopes each query to that caller. Better Auth 1.7.7 owns the identity handshake, database sessions, cookie signatures, expiry and logout. PortfolioPilot derives its opaque owner context from a verified, current session; browser JSON and model arguments cannot supply an owner.

## Local demo

Use Node 24.21.0/npm 11.19.0 and PostgreSQL from milestone 05. From the repository root in PowerShell:

```powershell
npm ci --no-audit --no-fund
npm run infra:start
Copy-Item apps/api/.env.example apps/api/.env.local # only if it does not already exist
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run build:types
npm run migrate:deploy --workspace @portfolio-pilot/db
npm run seed:demo --workspace @portfolio-pilot/db
npm run dev
```

In an existing .env.local, merge DATABASE_URL, DEMO_AUTH_ENABLED=true and AUTH_BASE_URL=http://localhost:5173 instead of overwriting it. Leave all Entra settings absent. Open **http://localhost:5173** (use this exact hostname, matching AUTH_BASE_URL). The sign-in page offers Alice and Bob without passwords. Alice owns demo-growth/demo-income; Bob owns demo-bob-core. The top session banner shows the authenticated identity and expiry. The financial screens are shared static teaching fixtures, explicitly labeled; they are not loaded from either user's private database yet. Sign out returns to the sign-in gate. Reloading a protected URL while anonymous renders sign-in.

For localhost HTTPS production, see the Entra configuration below; never enable the demo setting. Local plain HTTP cookies are HttpOnly/SameSite=Lax; production cookies are additionally Secure. Set a persistent random AUTH_SECRET locally if sessions must survive API restart.

## Acceptance verification

The optional API integration suite requires an isolated database named portfolio_m07_auth_verify on loopback. It seeds fixtures and expires/revokes test sessions; never point it at application data. With the milestone 06 verification container available:

```powershell
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d postgres -c 'CREATE DATABASE portfolio_m07_auth_verify'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m07_auth_verify'
npm run migrate:deploy --workspace @portfolio-pilot/db
$env:AUTH_TEST_DATABASE_URL=$env:DATABASE_URL
npm run test --workspace @portfolio-pilot/api
```

Create the database once; reruns reuse the database and idempotent seed. Without AUTH_TEST_DATABASE_URL, the eight integration tests explicitly skip. Three auth unit tests and the earlier API tests still run. Acceptance uses real library handlers, signed cookies, Prisma and PostgreSQL: anonymous 401, malformed identity rejection, both owners isolated, identical missing/foreign 404s, forged first-login and cookie mutation 403s, logout replay 401, expired/tampered cookie 401. Production configuration checks Secure cookies and no demo plugin. OIDC initiation checks tenant URL, redirect URI, state, PKCE, openid scope, foreign redirect rejection and forged callback rejection. Library CSRF checks are explicitly enabled so test-mode defaults cannot hide missing protection.

Manual HTTP checks through the browser's same-origin Vite proxy use `/api/me`, `/api/portfolios/demo-growth` and `/api/portfolios/demo-bob-core`. The restricted `/api/demo/ask` additionally requires an authenticated session, exact trusted Origin, development mode, loopback and explicit demo opt-in. CLI mutations must include `Origin: http://localhost:5173`. Health remains anonymous. Auth handshake/options endpoints are intentionally public; other library routes return 404.

## Production Microsoft Entra ID

Register a confidential **Web** application in one Entra tenant. Configure redirect URI `https://<public-host>/api/auth/callback/microsoft`. Configure the ID token's optional email claim for managed users (the library requires an email; it is not used to authorize or link users). Use the tenant UUID, not common/organizations, and supply server-only values through a secret manager:

```text
NODE_ENV=production
DEMO_AUTH_ENABLED=false
AUTH_BASE_URL=https://<public-host>
AUTH_SECRET=<persistent random secret of at least 32 characters>
DATABASE_URL=<private PostgreSQL connection>
ENTRA_TENANT_ID=<tenant UUID>
ENTRA_CLIENT_ID=<application ID>
ENTRA_CLIENT_SECRET=<client secret>
```

One HTTPS gateway serves Vite static files and proxies `/api` to Next.js. Browser requests remain relative/same-origin; no wildcard or credentialed CORS is configured. AUTH_BASE_URL must be the exact public origin without a trailing slash/path. Every API replica needs the same secret and database. Password auth/account auto-linking are disabled. Entra's verified oid anchors the provider account; application ownership uses the resulting database User ID. App logout invalidates the local session, not Microsoft SSO. Missing/partial production settings or demo opt-in reject startup.

**Locally verified:** library wiring/types, durable demo sessions and revocation, startup policy, secure-cookie configuration, tenant-specific authorization URL with state/PKCE, untrusted redirects and forged callbacks rejected. **Requires real credentials:** Microsoft interactive consent/sign-in, authorization code exchange, JWKS-backed ID token/nonce verification with real tokens, optional email claim configuration, account persistence and subsequent sign-in, HTTPS gateway cookie round trip, tenant policy/MFA behavior. Next verification: configure the variables above, `npm run build`, `npm run start --workspace @portfolio-pilot/api`, serve the web build behind the same HTTPS origin, click “Sign in with Microsoft”, confirm `/api/me`, sign out and confirm 401. No live Entra success is claimed.

## Results and teaching pitfalls

All eight database integration checks plus three auth unit checks passed; all API tests together passed (17). Full unit suite passed (30 tests; eight optional integration tests skipped without their URL). Build, typecheck and browser dependency boundary check passed. Live Next.js through Vite passed anonymous rejection, demo login, /me, cross-owner rejection, authenticated mock AI, origin rejection and logout replay. Production startup with demo enabled exited 1, including with otherwise complete fixture OIDC configuration. Instrumentation explicitly exits because merely throwing can leave Next.js listening. Existing Vite directive warnings and three Next.js instrumentation Node/Edge analysis warnings remain.

Browser visual/interaction verification could not run: the computer-use service reported no available browser. Next manual check: `npm run dev`, open http://localhost:5173, sign in as Alice, sign out, sign in as Bob, reload a protected route, and inspect the HttpOnly cookie in browser developer tools. No visual QA success is claimed.

Do not treat cookie presence as authentication, allow email-based ownership, accept a user ID as a demo credential, cache session data across logout, disable CSRF for tests, use a different local hostname than the configured origin, or enable the demo in production. Do not serialize raw sessions or provider tokens to the browser. Later CRUD routes must use requireAuthorization/requirePortfolio and ownerRepositories; their mutations must retain the origin check.
