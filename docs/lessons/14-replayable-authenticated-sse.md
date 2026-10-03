# 14 — Replayable authenticated SSE

The Node.js Route Handler at `/api/events` streams named application events using the existing
same-origin session cookie. It sends `text/event-stream`, private/no-cache/no-store/no-transform,
`Vary: Cookie` and `X-Accel-Buffering: no`. Access tokens never belong in EventSource URLs.

## Snapshot before stream

1. Authenticate, then fetch `/api/events/recovery` and apply its snapshot.
2. Open `/api/events?cursor=<encoded snapshot.cursor>`. If the cursor is null, retry recovery later.
3. Validate named event DTOs and deduplicate by UUID. The server advances a signed composite ID
   containing user and market positions. EventSource automatically sends that ID on reconnect.
4. On `stream.reset`, close the EventSource, discard the old cursor and repeat recovery. The fixed
   recovery URL is authenticated again; a foreign cursor never selects someone else's stream.

The snapshot cursors are captured before database reads, so changes during recovery are replayed.
Duplicate events already represented by the snapshot are expected. The signed cursor is not an
access token; its signature binds positions to the current authenticated user and prevents scope
substitution. It uses the shared AUTH_SECRET, so set that value for multiple API processes.

## Fan-out, bounds and cleanup

Each API instance independently reads Redis ranges. Within an instance, clients at the same
scope/cursor share one read promise. This is local fan-out, not a Redis consumer group. The same
event can reach every pod. There are no blocking Redis reads and no Redis connection per browser.
Polling adds at least the configured 500 ms interval plus Redis latency; the provider itself may
also poll. Never label the feed as instantaneous market data.

The 64 KiB byte queue closes with a reset on overflow. The hub admits 256 connections per process
and 16 per user. Heartbeat comments use a 15 second interval. Database-backed session checks run
every 30 seconds with a 2 second deadline; expiry closes on its timer. Disconnect/cancel removes
the subscription and clears timers/listeners. Browser disconnect never cancels an agent run.

Only projected, validated public DTOs leave the API. News drops source-event and owner metadata;
market events contain only security IDs and quote timestamps. Agent schemas define visible text,
sequence/block/message IDs and enum progress, but this milestone does not produce agent events.

## Demonstration

Configure API and worker `.env` files from their examples, pointing at the same seeded PostgreSQL
database and Redis. Set DATA_MODE=mock, DEMO_AUTH_ENABLED=true, AUTH_BASE_URL=http://localhost:5173
and a shared AUTH_SECRET of at least 32 characters. Then run:

```powershell
npm.cmd run build:types
npm.cmd run seed:demo --workspace=@portfolio-pilot/db
npm.cmd run dev
```

Sign in as Alice at http://localhost:5173. In the browser console:

```javascript
const snapshot = await fetch('/api/events/recovery').then(r => r.json());
const stream = new EventSource('/api/events?cursor=' + encodeURIComponent(snapshot.cursor));
for (const type of ['news.available', 'quote.updated', 'portfolio.updated', 'watchlist.updated']) {
  stream.addEventListener(type, e => console.log(type, e.lastEventId, JSON.parse(e.data)));
}
stream.addEventListener('stream.reset', e => { console.log(JSON.parse(e.data)); stream.close(); });
```

Rename a portfolio in the UI. In another terminal (using the worker's configured database/Redis):

```powershell
$env:WORKER_ROLE='outbox'
$env:WORKER_ONCE='true'
npm.cmd run start --workspace=@portfolio-pilot/worker
```

Observe one named notification. Network response content shows heartbeat comments after 15 seconds.
Close the connection with `stream.close()`. A fresh `/api/events` without a cursor returns a reset.
Try Alice's cursor while signed in as Bob: it resets to Bob's authorized recovery flow.
The console demo does not apply UI cache updates; the connection manager is milestone 15.

## Acceptance tests

Create a disposable `portfolio_m14_verify` database on local PostgreSQL and apply migrations:

```powershell
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m14_verify'
npm.cmd run migrate:deploy --workspace=@portfolio-pilot/db
$env:SSE_TEST_DATABASE_URL=$env:DATABASE_URL
$env:SSE_TEST_REDIS_URL='redis://127.0.0.1:6379/14'
$env:DATA_MODE='mock'
npm.cmd run test --workspace=@portfolio-pilot/api
```

The SSE integration suite refuses another database or non-loopback host. It seeds demo users,
uses real Better Auth cookies, tests owner-bound recovery, replay and duplicate publication across
two independent hubs, and deletes only its random Redis namespace. Other API integration suites
need their existing AUTH_TEST_DATABASE_URL and PORTFOLIO_TEST_DATABASE_URL settings.
Unit tests use fake timers for heartbeat, expiry, revocation, timeout, cancellation and overflow.
Full results and any local tooling workarounds are recorded in project-state.md.

Next lessons implement the shared browser connection manager and snapshot recovery, followed by
news UI and agent producers. Deployed ingress behavior and real two-pod HTTP failover remain later
acceptance work; two independent hubs against real Redis are tested here.
