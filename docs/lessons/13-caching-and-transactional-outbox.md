# 13 — Caching and the transactional outbox

PostgreSQL decides what happened. Redis helps reads go faster and carries notifications that
something happened. Every design choice in this lesson follows from keeping those two roles apart.
Read [ADR 0007](../decisions/0007-cache-outbox-and-redis-streams.md) for the full policy and the
alternatives we rejected.

## The problem with "save, then publish"

If a service commits a trade and then calls `XADD`, a crash between the two steps loses the event.
If it publishes first and the transaction then rolls back, it announces a trade that never existed.
The outbox removes that gap. The event is just another row, written with the same transaction
client as the change:

```ts
const row = await tx.portfolioTransaction.create({ ... });
await changed(tx, id, 'transaction.recorded', row.id); // appendEvent(tx, …)
if (!validateLongOnlyLedger(...)) throw new PortfolioError(409, ...); // rolls back BOTH
```

The event is appended *before* ledger validation on purpose. The acceptance test records an
oversell and checks that the trade and its event both disappeared. Portfolio create/rename/archive,
trades, and watchlist add/change/remove all do this. Idempotent replays (same trade key, duplicate
watchlist add) emit nothing.

Each event has a stable UUID (its identity forever), `type`, `schemaVersion`, UTC `occurredAt`,
an audience (`user` + owner, `market`, or `system`), `entityType`/`entityId`, an optional
`portfolioId`, and a payload. The payload is validated by Zod schemas in `packages/contracts`.

## The dispatcher

`WORKER_ROLE=outbox` runs `dispatchOnce` in a loop:

1. **Claim** up to 50 due rows in sequence order with `FOR UPDATE SKIP LOCKED`, stamping a 30 s
   lease and a fresh claim token. Replicas get disjoint batches. Attempts count at claim time,
   so even an event that crashes the process uses up its budget.
2. **Publish** (or fan out, for system events).
3. **Acknowledge** with the claim token. If the lease expired and another dispatcher re-claimed the
   row, the old token no longer matches and the late acknowledgement does nothing.
4. On error: back off exponentially with jitter (1 s, 2 s, 4 s … ≤ 5 min). After 8 attempts the row
   becomes `DEAD`. `requeueDead(id)` is the operator path once the cause is fixed.

### Why duplicates are normal

Suppose step 2 succeeds and the process dies before step 3. The row is still `PENDING`. After the
lease expires, another dispatcher publishes it again: **same UUID, new stream entry ID**. This is
at-least-once delivery. We do not claim exactly-once, because no Redis trick fully removes this
window. Consumers deduplicate on the UUID instead:

```ts
await consumeOnce(read.events, deduper, applyEvent); // remembers an ID only after success
```

The stream entry ID (`1790934404700-0`) is a *cursor*: where you are in the log. The UUID is
*what happened*. Never key side effects on the cursor.

## Streams, privacy and news fan-out

- `pp:v1:events:user:{userId}` — only that owner's events. Readers also re-check each envelope's
  audience.
- `pp:v1:events:market` — `quote.updated` with security IDs and timestamps only. It contains no user
  data and no prices.

Ingestion is global. For each article whose accepted metadata changed, it writes one internal
`news.article.ingested` event. Identical replays write none. That event is never published.
Instead the dispatcher looks up interested owners (open positions in non-archived portfolios, or
watchlist entries) and writes one `news.available` event per owner, listing only *that owner's*
portfolio IDs. Notification IDs are UUIDv5(source event, owner) inserted with
`ON CONFLICT DO NOTHING`, so redelivering the source event cannot create a second notification.

## Retention and snapshot recovery

Streams are trimmed to ~1000 (user) / ~10000 (market) entries and expire after 30 idle days. The
replay window is 7 days. A cursor looks like `v1.<epoch>.<entry-id>`. `readEvents` returns
`{ status: 'reset' }` if the cursor is malformed, from another Redis dataset (the epoch changed after
data loss), too old, or if entries after it may be gone.

> We found during this milestone that Redis updates `max-deleted-entry-id` for `XDEL` but **not**
> for trimming. Trimming is therefore detected separately and conservatively: if anything was
> removed and your cursor is older than the first retained entry, you reset. An occasional
> unnecessary reset is acceptable; silently skipping an event is not.

On reset, the client calls `GET /api/events/recovery`. The server captures the stream cursors
**first**, then reads the owner's portfolios, watchlist and news. Anything committed afterwards is
published after the cursor, so it is replayed. Anything already in the snapshot might also replay,
which dedupe absorbs. Milestones 14–15 build SSE and the browser on top of this handshake.

## Cache-aside

| Data | Key (prefix `pp:v1:cache:`) | TTL | Invalidation |
| --- | --- | --- | --- |
| Latest quote per security (global) | `quote:latest:<securityId>` | 15 s ± 20 %; missing 5 s | `quote.updated` deletes it |
| Owner news (all or one portfolio) | `news:user:{<userId>}:g<generation>:portfolio:<id or *all>:limit:<n>` | 60 s ± 20 % | any owner event increments the generation |

- **Versioned keys:** change `v1` when a cached shape changes; old keys simply expire.
- **Jitter:** keys filled together do not expire together.
- **Owner scoping:** the user ID comes from the session-derived owner context, never from the request.
  Only the owner's loader writes their keys, after an owner-filtered query. Bob asking for Alice's
  portfolio news gets a 404, which is never cached.
- **Single-flight:** concurrent misses in one process share one promise. Across processes a
  `SET NX PX` lock lets one loader run while others poll for ≤ 1 s. The acceptance test fires
  20 requests from two separate cache instances and sees exactly one database load.
- **Invalidate before publish:** the dispatcher bumps the generation, *then* calls `XADD`. A client
  that refetches because of an event can never get the pre-event cached value.
- **Fail open:** no `REDIS_URL`, a Redis error or a 250 ms timeout means "read PostgreSQL", and Redis
  is skipped for 5 s. Valuations and ledgers are deliberately not cached.

New authenticated routes: `GET /api/quotes?securityId=…` (≤ 50), `GET /api/news[?portfolioId=&limit=]`,
and `GET /api/events/recovery`. Responses carry `generatedAt`/`servedAt` and each quote's own `asOf`,
so cached age is never hidden.

## A clock lesson

The first combined test runs failed intermittently. Events created by the app were sometimes not
claimable for a moment. Cause: Prisma's `@default(now())` can fill `availableAt` from the Node
clock, while the claim compares it with PostgreSQL's `clock_timestamp()`. The Docker VM clock and
the host clock differ slightly, so a fresh event could look scheduled in the future. The fix is
`@default(dbgenerated("clock_timestamp()"))` (migration `20261003093000_outbox_db_clock`): any time
compared with the database clock must come from the database clock.

## Run it

Use Node 24.21.0/npm 11.19.0 (prepend the nvm directory to `PATH` as in earlier lessons).

```powershell
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m13_verify'
$env:REDIS_URL='redis://127.0.0.1:6379/13'
$env:DATA_MODE='mock'
npm.cmd run migrate:deploy --workspace @portfolio-pilot/db
npm.cmd run build
$env:NODE_ENV='development'; $env:ALLOW_DEMO_SEED='true'
npm.cmd run seed:demo --workspace @portfolio-pilot/db
$env:WORKER_ROLE='ingestion'; $env:WORKER_ONCE='true'; $env:MOCK_NEWS_INTERVAL_MS='1000'; $env:INGESTION_INTERVAL_MS='1000'
npm.cmd run start --workspace @portfolio-pilot/worker
$env:WORKER_ROLE='outbox'
npm.cmd run start --workspace @portfolio-pilot/worker   # prints {"claimed":…,"published":…}
```

Remove `WORKER_ONCE` to run continuously. Start two outbox workers to see SKIP LOCKED share the
work. Inspect:

```powershell
'SELECT type, audience, status, attempts, "streamEntryId" FROM "OutboxEvent" ORDER BY sequence;' | docker exec -i portfolio-pilot-m06-verify psql -U portfolio_local -d portfolio_m13_verify
docker exec portfolio-pilot-local-redis-1 redis-cli -n 13 XRANGE pp:v1:events:market - +
docker exec portfolio-pilot-local-redis-1 redis-cli -n 13 --scan --pattern 'pp:v1:*'
```

The seeded mock feed mentions only `ACME`, which the seed deliberately lists on two exchanges.
Ambiguous tickers are never associated (lesson 12), so the CLI demo shows quote events but no news
fan-out. The acceptance test demonstrates fan-out with unambiguous securities.

For the HTTP path, start the API (`npm.cmd run dev`) with the same `DATABASE_URL`/`REDIS_URL`,
`DEMO_AUTH_ENABLED=true` and `AUTH_BASE_URL=http://localhost:5173`. Sign in as Alice at
http://localhost:5173 and, in the browser console, call `fetch('/api/news').then(r => r.json())`
and `fetch('/api/events/recovery').then(r => r.json())`. Add a watchlist item Alice does not have
yet, run the outbox worker once, then observe `pp:v1:cache:gen:user:{demo-alice}` increase and a new
`g<n>` news key appear on the next read.

## Tests

```powershell
$env:OUTBOX_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m13_verify'
$env:OUTBOX_TEST_REDIS_URL='redis://127.0.0.1:6379/13'
$env:INGESTION_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m12_verify'
npm.cmd run test --workspace @portfolio-pilot/worker
```

The acceptance suite refuses non-loopback hosts and non-`*_verify` databases. It uses a random
Redis key namespace and deletes only its own keys and rows. It covers commit/rollback atomicity,
owner-only streams, publish retry with sanitized errors, the bounded `DEAD` budget and requeue,
crash-after-publish duplicates with fenced late acknowledgements, idempotent fan-out redelivery,
data-free market events, quote invalidation, cross-process single-flight, owner isolation, Redis
outage fallback, trim/XDEL/expiry/epoch resets, the approximate length bound, and race-free
snapshot replay. Without the two variables it is skipped, never reported as passing.
