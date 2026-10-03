# 16 — Complete live news experience

## What the learner builds

The authenticated News route reads persisted owner-scoped articles, filtered by all interests,
one owned active portfolio or watchlist only. Portfolio interests use positive remaining stock
quantity, matching the outbox audience rule. Cards show publisher/provider, UTC publication,
actual PostgreSQL observation/ingestion time, provider update time, exchange-aware securities,
revision, read status, and explicit synthetic/delay labels. Seeded rows without observations say
delay unknown rather than inventing freshness. All delivery is described as provider polling.

The detail dialog provides the canonical source, immutable correction history with the accepted
observation marked, and current related exposure calculated by the existing decimal portfolio
service: shares, valuation, allocation, quote freshness and quote provenance. It does not predict
a price change. The native dialog traps focus, supports Escape and restores the opener's focus.

All text is untrusted. Title, summary and provenance render as React text children after bounding
length and removing control characters. Markup remains literal text; no HTML/Markdown renderer or
`dangerouslySetInnerHTML` is used. External HTTP(S) links reject credentials and use a new tab,
`noopener noreferrer`, and `referrerPolicy="no-referrer"`. Provider samples retain those rules and
now live under Settings; they are explicitly separate from persisted news and portfolio valuation.

## Stable reading and pagination

The feed orders publication time descending, then ID ascending. A validated base64url keyset cursor
contains the last publication timestamp and ID. Ownership and relevance are checked independently
on every request, including a forged cursor. A newly inserted top story cannot offset subsequent
older pages. The UI appends requested pages with ID deduplication, then disables that page query.
SSE invalidation cannot silently append more rows. Changed publication timestamps can move rows;
this is current-state pagination, not a historical snapshot.

React holds the displayed rows and correction text stable while authoritative queries refresh.
A reserved-height, polite atomic live region announces pending news. The latest 100 validated
owner notifications also announce older-page corrections. Its count is bounded, not a durable
unread counter. `Show updates` is enabled after the authoritative read settles and returns to the
newest page only on the user's action, without automatic scrolling. Incoming events never steal
focus. Reset recovery reconciles snapshots; logout discards both retained rows and notifications.

`NewsRead` is keyed by authenticated owner and article. It stores when the user read the article
and the displayed article revision timestamp. Repeating the same read returns the same receipt.
A later correction displays **Updated since you read it**, while preserving the receipt. Read
state is loaded directly from PostgreSQL after cached feed content, so a stale cache cannot erase
a read. Another tab picks up read state on its next authoritative read; this slice has no read
receipt SSE event. Mark-read origin checks and relevance/ownership checks are server-side.

## Full event journey

```mermaid
flowchart LR
  CLI[Development fixture CLI] --> Provider[Fixture NewsProvider]
  Provider --> Worker[Worker ingestOnce + fenced lease]
  Worker --> TX[PostgreSQL ingestion transaction]
  TX --> Article[Article + aliases + immutable observations]
  TX --> Internal[Outbox news.article.ingested]
  Internal --> Fanout[Outbox worker owner relevance fan-out]
  Fanout --> Notice[Outbox news.available per owner]
  Notice --> Redis[Generation invalidation + owner Redis Stream]
  Redis --> SSE[Cookie-authenticated API SSE + signed cursor]
  SSE --> React[Validated UUID-deduped React notification]
  React --> API[Refetch authorized PostgreSQL feed/detail]
  API --> Indicator[Pending updates indicator]
  Indicator --> Reading[User selects Show updates]
```

1. `news:inject` validates development + mock + loopback PostgreSQL **before connecting**.
   Production, test, missing environment, live mode and non-loopback databases are rejected. There
   is no HTTP injection endpoint or browser injection hook. CLI arguments are validated before
   the first write. The first invocation stores a fixture clock; repeats reuse it.
2. A short-lived worker schedule acquires the same fenced PostgreSQL lease used by normal
   ingestion. A fixture `NewsProvider` supplies one normalized NOVA story; the quote adapter returns
   an empty batch. `ingestOnce` calls the existing repository commit, never a browser write.
3. The ingestion transaction canonicalizes the URL, resolves aliases, fingerprints normalized
   evidence (excluding arrival time), inserts an immutable observation, links unambiguous securities,
   and writes the internal outbox event. Duplicate fingerprints do not update the article or emit
   another event. The accepted observation pointer and displayed revision update together.
4. Revision 2 reuses the same source record/canonical URL/publication time, with a later provider
   timestamp. It updates the same article. A lower revision at the same timestamp or an older
   delivery stays history and cannot replace accepted provenance. Corrections fan out to both
   previous and current securities, allowing removed relevance to refresh. Canonical merges retain
   aliases, observations and read records.
5. The outbox dispatcher derives interested users from current active holdings and watchlists,
   emits one deterministic owner notification UUID per source event, and acknowledges the internal
   event in the same transaction. Alice has NOVA; Bob only has ACME / XNYS, so Bob gets no notice.
6. Owner notifications invalidate that user's cache generation before Redis publication. Redis
   carries only stable application envelopes, not article bodies. Repeated delivery uses the same
   UUID. API SSE authenticates the HttpOnly cookie, authorizes replay and signs user-bound cursors.
7. The React manager validates the named event, advances its cursor independently from UUID dedupe,
   and refetches relevant read models. The new-articles indicator stages the change. Source content
   only enters the UI through the authenticated API. Refresh/reconnect recovers durable DB truth.

## Exact local demo

Use pinned Node 24.21.0/npm 11.19.0 and the existing local Compose PostgreSQL and Redis. No market
or AI credentials are required. Run this environment block in **each** terminal (worker/CLI commands
read process environment; they do not implicitly load a Next.js `.env` file):

```powershell
$env:NODE_ENV='development'
$env:DATA_MODE='mock'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:REDIS_URL='redis://127.0.0.1:6379/0'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
$env:AUTH_SECRET='local-news-demo-only-change-before-sharing-123456'
$env:MOCK_NEWS_INTERVAL_MS='1000'
```

Terminal 1:

```powershell
npm.cmd run build:types
npm.cmd run build --workspace=@portfolio-pilot/worker
npm.cmd run migrate:deploy --workspace=@portfolio-pilot/db
$env:ALLOW_DEMO_SEED='true'
npm.cmd run seed:demo --workspace=@portfolio-pilot/db
npm.cmd run dev
```

Terminal 2 (continuous delivery):

```powershell
$env:WORKER_ROLE='outbox'
npm.cmd run start --workspace=@portfolio-pilot/worker
```

Terminal 3 can run the regular ingestion role independently:

```powershell
$env:WORKER_ROLE='ingestion'
npm.cmd run start --workspace=@portfolio-pilot/worker
```

Terminal 4 runs the real short-lived ingestion worker fixture path:

```powershell
npm.cmd run news:inject --workspace=@portfolio-pilot/worker -- lesson16-demo 1
# Repeat: no new article, observation or notification.
npm.cmd run news:inject --workspace=@portfolio-pilot/worker -- lesson16-demo 1
# Correction: same article ID, new observation and pending update.
npm.cmd run news:inject --workspace=@portfolio-pilot/worker -- lesson16-demo 2
# Repeating correction and older revision do not regress freshness.
npm.cmd run news:inject --workspace=@portfolio-pilot/worker -- lesson16-demo 2
npm.cmd run news:inject --workspace=@portfolio-pilot/worker -- lesson16-demo 1
```

Open http://127.0.0.1:5173/news and sign in as Alice. Select Watchlist only or Long term, scroll
into a story, and inject revision 1. Observe the indicator without a moved reading position; select
Show updates and see exactly one fixture story. Open its detail, verify NOVA exposure (4 shares),
source/provenance, and mark it read. Inject revision 2: the displayed feed stays still until the
update action, then shows the correction and Updated since you read it. Refresh to see persisted
state. Sign in as Bob in an incognito window: neither fixture version is in his feed, and Alice's
article detail/read URLs return 404 to Bob. Use a new fixture ID to start a fresh demo later; a
previously corrected fixture deliberately does not revert to revision 1.

## Acceptance and verification

Use a disposable loopback database ending in `_verify`, apply all migrations and seed it. The
actual acceptance database was `portfolio_m16_verify` on port 5546. Configure the API and fixture
CLI with that same database and Redis `redis://127.0.0.1:6379/6`, using the environment above.
Redis's default database range is 0–15; **do not use database 16** just because this is lesson 16.
Start API/Vite, then in another terminal:

```powershell
$env:NEWS_E2E='true'
npm.cmd run test:browser --workspace=@portfolio-pilot/web -- news-live.spec.ts news.spec.ts streaming.spec.ts shell.spec.ts providers.spec.ts
```

The live test has no mocked API, stream or browser record insertion: it signs both users in with
real cookies, invokes the compiled fixture CLI, runs real outbox passes, consumes native SSE and
checks React. It verifies scrolled reading stability, repeat/correction/stale replay idempotency,
detail provenance, read receipt freshness, current exposure, reload, and Bob's HTTP 404 isolation.
The separate controlled browser test checks pagination dedupe, inert malicious markup, unsafe URL
suppression, safe canonical links, dialog keyboard/focus, and older-page correction notification.

Run infrastructure tests **sequentially relative to the browser demo**, or use another disposable
database: different Redis databases alone do not isolate the shared PostgreSQL outbox.

```powershell
$env:NEWS_TEST_DATABASE_URL=$env:DATABASE_URL
$env:INGESTION_TEST_DATABASE_URL=$env:DATABASE_URL
$env:OUTBOX_TEST_DATABASE_URL=$env:DATABASE_URL
$env:OUTBOX_TEST_REDIS_URL='redis://127.0.0.1:6379/7'
npm.cmd run test --workspace=@portfolio-pilot/worker -- --maxWorkers=1
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd run check:browser-boundary
```

The opt-in browser test skips without `NEWS_E2E=true`; infrastructure Vitest tests skip without
their explicit database/Redis variables. Skips are not a claim of integration success.

On this sandbox, activate Node without changing nvm globals:

```powershell
$env:PATH='C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0;'+$env:PATH
# npm ci --ignore-scripts leaves the engine executable absent. Copy the readable cache locally.
Copy-Item -LiteralPath 'C:/Users/luisc/AppData/Roaming/Prisma/master/0edf323efd1d98336f3f0a68684b56f689b900d3/windows/schema-engine' -Destination 'node_modules/@prisma/engines/schema-engine-windows.exe'
$env:PRISMA_SCHEMA_ENGINE_BINARY=(Join-Path $PWD 'node_modules/@prisma/engines/schema-engine-windows.exe')
```

For a generated Next.js route-type race, stop `npm run dev`, then run
`npm.cmd exec --workspace=@portfolio-pilot/api -- next typegen` before typechecking. Do not edit
generated route declarations by hand. Existing Next instrumentation Edge warnings and Vite module
directive warnings are recorded separately from test failures.

## Exercise and limitations

Change a fixture's related securities through a correction and verify both old and new audiences
get a notification but each authoritative feed uses current relevance. Try an expired replay cursor
and observe snapshot recovery. Explain why an SSE cursor, article ID, or pagination cursor is never
authorization.

Only normalized titles/summaries are stored and rendered; full publisher HTML is not fetched.
Read receipts are per user, not an AI run or market claim. Observation history is bounded in the
detail response, while accepted provenance remains independently available. Fixture schedules and
browser acceptance articles remain in the disposable local database for inspection; no production
injection endpoint exists. Live providers, AI analysis and cloud deployment are outside this slice.
