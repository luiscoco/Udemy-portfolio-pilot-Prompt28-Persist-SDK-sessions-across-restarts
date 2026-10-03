# 15 — Frontend streaming and snapshot recovery

The authenticated React tree owns one `StreamManager`. `StreamingProvider` uses
`useSyncExternalStore` and shares its connection state through context. Initial authentication
mounts a provider keyed by user ID; logout/session expiry clears React Query and unmounts it.
An identity change detected by `/api/me` also clears the old cache before mounting the new scope.
Subscription cleanup waits one microtask, so React StrictMode's synchronous cleanup/setup probe
keeps one recovery request and connection. A real unmount closes EventSource, aborts recovery,
removes online/offline listeners, clears retries, cursor and UUID history. Generation checks fence
late recovery responses and pending cache invalidations. Authentication requests are also fenced
on unmount and session expiry.

## Snapshot/replay algorithm

1. Fetch the authenticated `/api/events/recovery` endpoint. The existing server captures both
   stream positions **before** reading the owner's PostgreSQL snapshots and signs a composite cursor.
2. Cancel reads for the recovered server-state query families before installing portfolios,
   watchlist and the owner news feed. Mark derived summaries, transaction pages, quote reads,
   filtered news and provider samples stale. Initially the workspace mounts only after recovery;
   on reset it retains its current view while reconciling.
3. Open `/api/events?cursor=<signed cursor>` after installing the snapshot. Events committed
   during snapshot reads or before subscription are replayed. Outbox publication after snapshot
   capture is also replayed even when the database already reflected that event.
4. Strictly validate each named event against `browserEventSchema`, including its matching type.
   A malformed event closes the stream and recovers instead of advancing past unknown data.
5. Advance the transport cursor for every valid domain event, even a duplicate UUID. Deduplicate
   UUIDs separately in a bounded 2,000-entry set. No cursor or private snapshot is persisted in
   local/session storage. A page reload takes a new authorized snapshot.
6. Events contain notifications rather than full versioned entity records. Use **targeted
   authoritative read reconciliation**, not partial record patches: cancel matching reads and
   invalidate/refetch their queries. Consequently an old replay event cannot overwrite a newer
   snapshot with old event data. Repeated notifications may refetch, but never duplicate entities
   or financial mutations. Explicit cancellation matters: TanStack can otherwise coalesce a
   pending first fetch without cached data, allowing a pre-event response to hide an update.
7. On connection error, explicitly close and reopen with the manager's latest cursor (1/2/4/8/15 s
   capped backoff). On any `stream.reset`, discard the cursor and retry the same fixed recovery
   endpoint. Expired, trimmed and changed stream epochs all use this path. A null recovery cursor
   displays the snapshot with Offline/Reconnecting status and retries recovery, never opening an
   unanchored stream. Offline closes the source; online resumes from the scoped cursor or recovers.

The database remains authoritative. Initial and reset snapshots need not be globally atomic:
any overlap is reconciled by replayed notifications and reads of current state, without replacing
records using stale event payloads. No event triggers a refetch of the whole application. A reset
is deliberately broader because the retained log can no longer describe the missing changes.

## Targeting and labels

- Portfolio: portfolio list and the specified summary; transaction events additionally target
  that portfolio's transaction pages and news relevance. Archive changes refresh news relevance.
- Watchlist: watchlist and authorized news feeds.
- News: the owner's default news feed, specified portfolio feeds and provider snapshot samples.
- Quotes: quote queries containing affected securities, summaries whose positions contain them
  (including unresolved summaries), and provider samples. Other holdings and health stay untouched.
- Agent events are validated and advance cursors; their UI belongs to milestones 18–19.

`Live`, `Reconnecting`, `Offline` describe the **app update connection**. Adjacent text says provider
polling and delays still apply. Existing synthetic/delayed/provider timestamp labels remain, as
does the five-second demo/provider sample polling. The News route also displays the authenticated
persisted portfolio/watchlist feed, which is driven by SSE rather than browser polling.

## Checks and demonstration

From the repository root with pinned Node/npm active:

```powershell
npm.cmd run typecheck
npm.cmd run test --workspace=@portfolio-pilot/web
npm.cmd run build --workspace=@portfolio-pilot/web
npm.cmd run check:browser-boundary
# Terminal 1: no API/database is needed for the controlled browser tests.
npm.cmd run dev --workspace=@portfolio-pilot/web
# Terminal 2:
npm.cmd run test:browser --workspace=@portfolio-pilot/web -- streaming.spec.ts
```

This Windows sandbox's default Prisma engine cache timestamp operation fails with EPERM.
The installed cache is readable; before the repository-wide typecheck use:

```powershell
$env:PRISMA_SCHEMA_ENGINE_BINARY = 'C:/Users/luisc/AppData/Roaming/Prisma/master/0edf323efd1d98336f3f0a68684b56f689b900d3/windows/schema-engine'
npm.cmd run typecheck
```

The five new unit tests verify query targeting, cancellation of a pending first fetch, scope fencing
and StrictMode recovery cleanup. Six Chrome browser tests exercise connection sharing, independent
UUID/cursor deduplication, native EventSource bytes and reconnect cursors, news updates, holding
valuation updates, offline/online, expired reset, malformed payload recovery and Alice/Bob isolation.
API calls are controlled Playwright routes; five tests control EventSource and one uses the native
browser implementation. They require Chrome and the Vite server, not infrastructure or credentials.

For the full local demo configure API/worker environments as in lesson 14, with the same seeded
DATABASE_URL and REDIS_URL, DATA_MODE=mock, DEMO_AUTH_ENABLED=true, AUTH_BASE_URL matching the Vite
origin and a shared AUTH_SECRET. Build and start the API/web and two worker roles:

```powershell
npm.cmd run build
npm.cmd run seed:demo --workspace=@portfolio-pilot/db
npm.cmd run dev
# Separate terminals with DATABASE_URL and REDIS_URL set to the same local instances:
$env:WORKER_ROLE = 'ingestion'
npm.cmd run start --workspace=@portfolio-pilot/worker
# Another terminal:
$env:WORKER_ROLE = 'outbox'
npm.cmd run start --workspace=@portfolio-pilot/worker
```

Sign in as Alice in two browser tabs. Rename a portfolio in one; the other updates without refresh.
Open News and observe relevant persisted stories as ingestion/outbox publish. Use browser DevTools
Offline then Online to see recovery. Sign out and sign in as Bob; Alice's private list and cursor
must disappear. The full PostgreSQL/Redis/worker browser journey was not rerun in milestone 15;
its server-side acceptance remains the recorded milestone 14 result. No live provider, AI or cloud
verification was attempted. Full news filtering/detail UX remains milestone 16.

## References checked 2026-10-02

- [TanStack QueryClient](https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryClient)
  and installed 5.102.8 `query-core/src/queryClient.ts` / `query.ts` for cancellation and invalidation.
- [MDN server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  and [EventSource.close](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/close), alongside
  installed DOM definitions for named events, `lastEventId` and explicit connection cleanup.
