# Lesson 06 — Prisma schema and reproducible data

The database now distinguishes private owner data from shared listing, quote and news data. Inspect [the diagram](../database-diagram.md), [the decision](../decisions/0002-database-ledger-and-auth.md), `packages/db/prisma/schema.prisma` and the generated migration. Prisma cannot represent CHECK constraints, so the migration includes hand-reviewed numeric/USD invariants after the generated SQL. Keep these constraints when creating future migrations.

Transactions are facts; positions are derived. BUY cash amount includes fees, SELL proceeds subtract fees. All decimal DTO values use fixed-point strings; `toFixed()` avoids exponent notation for small fractional shares. Never use JavaScript Number for ledger arithmetic. The fictional ACME listings demonstrate why symbol alone is insufficient.

## Local demonstration (PowerShell)

Use Node 24.21.0 and npm 11.19.0. On this host, prepend `C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0` to PATH; if npm's shim is inactive, invoke that installation's node.exe with `node_modules/npm/bin/npm-cli.js`.

```powershell
npm ci --no-audit --no-fund
npm run build
npm run infra:start
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
npm run migrate:deploy --workspace=@portfolio-pilot/db
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run seed:demo --workspace=@portfolio-pilot/db
npm run seed:demo --workspace=@portfolio-pilot/db
```

Both runs upsert exactly two users, three portfolios, three fictional listings, five trades, two watchlist entries, three synthetic quotes, three synthetic articles and three article/listing links. No passwords, tokens, accounts or sessions are seeded. The fixture clock is **2025-01-15T16:00:00Z**. These prices are invented historical teaching values, never current market prices. Seeding does not run during startup, build or migration. It rejects production, missing explicit opt-in and non-loopback database URLs; never tunnel a production database into this local workflow.

## Isolated integration demonstration

The verifier requires a newly migrated, empty disposable database named `portfolio_m06_verify`. It deliberately modifies fixtures to test cascades. Do not run it against the normal application database or repeat it against a populated database. Start a new disposable container when repeating this lesson.

```powershell
docker run --detach --name portfolio-pilot-m06-verify --publish 127.0.0.1:5546:5432 --env POSTGRES_USER=portfolio_local --env POSTGRES_PASSWORD=local_only_change_me --env POSTGRES_DB=portfolio_m06_verify postgres:17.6-alpine
# Wait until PostgreSQL is ready:
docker exec portfolio-pilot-m06-verify pg_isready -U portfolio_local -d portfolio_m06_verify
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m06_verify'
npm run migrate:deploy --workspace=@portfolio-pilot/db
$env:NODE_ENV='test'
npm run verify:database --workspace=@portfolio-pilot/db
npm run test
npm run typecheck
npm run check:browser-boundary
```

The verifier compares every fixture row/timestamp after sequential and concurrent seeds; tests missing/expired/revoked sessions and fabricated contexts; checks cross-owner portfolio, ledger, watchlist, quote and news visibility; exercises owned portfolio/watchlist mutations; checks decimal DTOs; tests SQL constraints, unique identities, restrictive listing deletion and owner cascades. Session tokens are randomly generated for the test and never printed. Auth contexts are request-scoped, not cached sessions. Cookie parsing and actual sign-in arrive in milestone 07; trade creation and aggregate long-only rules arrive in milestone 08/09.

## Actual validation on 2026-10-01

Prisma 7.10.0 schema validation and client generation passed. The first migration attempt lacked generated table SQL because the schema engine needed permission to execute; PostgreSQL rejected it before any application tables were created. Regenerated SQL with engine access, marked the failed attempt rolled back with `prisma migrate resolve --rolled-back 20261001000000_initial`, then deployed successfully to the empty local PostgreSQL 17.6 database. No reset was performed. The integration verifier passed all three result groups. See project state for final project-wide check results.

Final verification additionally deployed directly into a second new empty database,
`portfolio_m06_verify_final`, and reran the integration checks including tiny fixed-point decimals.
Build, typecheck, all 27 unit tests and the browser dependency boundary check passed.
Existing build warnings remain. An optional engine-based schema-drift comparison reported P1001
while adapter integration and container readiness passed; see project state for the exact retry.
The verifier accepts either dedicated verification database name.
