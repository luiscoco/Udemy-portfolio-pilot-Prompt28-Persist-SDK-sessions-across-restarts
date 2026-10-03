# 12 — Live providers and resilient ingestion

The adapter normalizes an external API. The worker decides when to fetch; PostgreSQL decides which
replica may commit and what progress survived. These are separate responsibilities. Read
[ADR 0006](../decisions/0006-alpaca-and-durable-ingestion.md) for API research and licensing boundaries.

## Data path

`packages/providers/server` exports Alpaca quote/news adapters. Transport and clock injection let
synthetic fixtures exercise official shapes without network calls or real keys. Quote price lexemes
become decimal strings before JSON can convert them to binary floating point. The quote is a last
IEX trade. The news adapter requests no content and drops raw fields. Nullable URLs are skipped.
News is deliberately 15 minutes delayed; quote coverage is IEX only. Publication/provider/ingestion
times are distinct UTC values. Provider update milliseconds form the revision value, not a vendor
sequence number. Polling availability is not upstream push.

`ingestionRepository` stores an initialization epoch once, claims a due schedule using PostgreSQL
time, and returns a generation token. `ingestOnce` fetches one page and the supported catalog's
quotes. The page transaction checks/locks that token, serializes canonical merges, writes records
and updates checkpoint/cursor. The lease is released after each page. Remaining pages become due
after one second; completed windows use `INGESTION_INTERVAL_MS`. The main loop checks every second.
Multiple replicas may wait, but only a valid claimant can commit. Slow work beyond lease expiry
must replay; shutdown completes an in-flight operation and closes connections.

Errors retain checkpoints. Backoff and provider retry guidance become a durable `nextRunAt`, so
restarting the worker cannot bypass a rate limit. DB failures log sanitized text and retry. Provider
configuration errors also fail closed; they do not switch to mocks.

`NewsSource` identifies provider IDs; `NewsUrl` identifies current and historical canonical URLs.
`NewsObservation` stores immutable normalized source history, fingerprinted without ingestion time.
Same-ID corrections and same-URL alternate IDs share an article; older deliveries retain evidence
without reverting the headline. A bridge between existing source and URL aliases merges history.
Current security associations follow the latest accepted metadata and require a unique USD stock
ticker. Ambiguous tickers do not guess a listing; every original symbol remains in source history.
Quote identity is `(security, provider, timestamp)` and retries do not rewrite existing snapshots.

The Prisma migration is additive and retains existing seeded articles. SQL foreign keys cascade
aliases/history with article deletion. These are operational ingestion records, not user-owned jobs;
existing authenticated repositories still scope portfolio/news reads to the session owner.

## Run the mock worker

Use Node 24.21.0/npm 11.19.0. On this Windows machine, if shims are inactive:

```powershell
$env:PATH='C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0;'+$env:PATH
npm.cmd ci --ignore-scripts
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m12_verify'
npm.cmd run migrate:deploy --workspace @portfolio-pilot/db
npm.cmd run build
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm.cmd run seed:demo --workspace @portfolio-pilot/db
$env:DATA_MODE='mock'
$env:WORKER_ROLE='ingestion'
$env:MOCK_NEWS_INTERVAL_MS='1000'
$env:INGESTION_INTERVAL_MS='1000'
$env:MOCK_SCENARIO='ordinary'
npm.cmd run start --workspace @portfolio-pilot/worker
```

Stop with Ctrl+C, then run the same start command. It resumes the persisted epoch/cursor, rather
than restarting at news-0. Start a second terminal with identical settings to exercise the lease.
`WORKER_ONCE=true` attempts at most one due page for a CLI smoke test. Mock scenarios have separate
schedule keys, so switch to `duplicates`, `corrections`, `outage` or `rate_limit` without reusing an
incompatible checkpoint. `MOCK_START_AT` affects the initial creation of that schedule only.

Inspect PostgreSQL (the container name below is the existing local verification container):

```powershell
'TABLE "IngestionState";' | docker exec -i portfolio-pilot-m06-verify psql -U portfolio_local -d portfolio_m12_verify
'SELECT provider, count(*) FROM "NewsArticle" GROUP BY provider;' | docker exec -i portfolio-pilot-m06-verify psql -U portfolio_local -d portfolio_m12_verify
'SELECT provider, "recordId", "providerAt" FROM "NewsObservation" ORDER BY "observedAt";' | docker exec -i portfolio-pilot-m06-verify psql -U portfolio_local -d portfolio_m12_verify
```

The current `/news` UI continues its milestone 11 snapshot path. It does not yet read the durable
ingestion table; cache/outbox/stream integration is later work. Portfolio valuation already reads
persisted quote snapshots when the API uses the same database. Synthetic labels remain explicit.

## Acceptance and live verification

```powershell
$env:INGESTION_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m12_verify'
npm.cmd run test --workspace @portfolio-pilot/providers
npm.cmd run test --workspace @portfolio-pilot/worker
npm.cmd run typecheck
npm.cmd run check:browser-boundary
# Dedicated existing API acceptance databases must also have all migrations:
$env:AUTH_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m07_auth_verify'
$env:PORTFOLIO_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
npm.cmd run test
```

The PostgreSQL acceptance test refuses non-loopback/non-`*_verify` databases and cleans up its own
UUID-scoped records. Without the database environment it is visibly skipped, never called passing.
It exercises real transactions, simultaneous claims, quote persistence, paginated restart, duplicate
replay, tracking-URL aliases, immutable correction history, outage/recovery, expiry fencing and
rollback without advancing progress. Recorded Alpaca tests exercise the reusable contract plus
timeouts, schema/network/auth failures, missing/ambiguous prices, content exclusion and retry headers.

Live smoke was **not run**: no credentials or storage/display entitlement were supplied. To verify
later, supply server `ALPACA_API_KEY` and `ALPACA_API_SECRET`, confirm the rights described in the ADR
before setting `ALPACA_STORAGE_DISPLAY_RIGHTS_CONFIRMED=true`, set `DATA_MODE=live`, `REDIS_URL` and
the target `DATABASE_URL`, then run the worker with `WORKER_ONCE=true`. Inspect source timestamps,
missing identities, persisted excerpts and `IngestionState`. A key alone does not justify enabling
the rights flag. Do not publish fixture keys, a populated live database, or raw provider responses.

An initial 24-hour lookback is intentional; corrections outside the one-hour overlap need a backfill.
Invalid checkpoints fail safely and need operator investigation rather than silent progress reset.
No paid subscriptions, account registration, trade execution or public deployment are part of this
lesson. See project state for actual command outcomes and dependency audit findings.
