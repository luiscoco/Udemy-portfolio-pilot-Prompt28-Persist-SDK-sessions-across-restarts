# 0007. Cache-aside, transactional outbox and Redis Streams delivery

- Status: Accepted
- Date: 2026-10-02
- Milestone: 13
- Refines: [0001](0001-architecture-baseline.md) (Redis role, at-least-once events)

## Context

Domain changes (portfolios, trades, watchlists, ingested news and quotes) must reach browsers in
milestones 14–15 through events. PostgreSQL is authoritative. Redis can lose data and can be
unavailable. If we write to PostgreSQL and then publish to Redis from application code, a crash
between the two steps loses events or publishes events for changes that rolled back. Read traffic
for quotes and owner news is repetitive and could put load on PostgreSQL. Article ingestion is
global, but news relevance and portfolio IDs are private to each owner.

Verified against the installed `redis` 5.10.0 types and a live Redis 7.4.5 server on 2026-10-02:
`XADD … MAXLEN ~`, exclusive `XRANGE (id`, `XINFO STREAM` (`max-deleted-entry-id`,
`recorded-first-entry-id`, `entries-added`), `SET NX PX`, `EVAL`, `TIME`. **Observed:**
`max-deleted-entry-id` changes on `XDEL` but **not** on `MAXLEN`/`XTRIM` trimming, so on its own it
cannot detect retention gaps.

## Decision

**Transactional outbox.** `OutboxEvent` rows are inserted with the domain change's transaction client
(`appendEvent(tx, …)`). If the transaction rolls back, the event never existed. If it commits, the
event survives a Redis outage. Each row stores a stable UUID (the domain event identity), a type, a
`schemaVersion` (1), `occurredAt` (UTC), the audience (`user` + `ownerId`, `market`, or `system`),
an optional `portfolioId`, the entity type and ID, and a Zod-validated payload from `contracts`.
SQL CHECKs bind audience to owner presence. Eligibility (`availableAt`) is stamped by the
PostgreSQL clock and compared with `clock_timestamp()`. The app clock is never used for it.

**Dispatcher (`WORKER_ROLE=outbox`).** The dispatcher claims a batch in sequence order with
`FOR UPDATE SKIP LOCKED`, stamping a lease (30 s) and a fresh claim token. Attempts are counted at
claim time. It publishes each event and then acknowledges it with the claim token (fenced:
a stale dispatcher's late acknowledgement changes nothing). On failure it reschedules with
exponential backoff and 50–100 % jitter (1 s doubling, capped at 5 min). After 8 attempts the row
becomes `DEAD`, including when leases expired repeatedly because of crashes. Envelopes with an
unknown schema version go to `DEAD` immediately. `requeueDead` is the operator path; the event
keeps its UUID. `PUBLISHED` rows are purged after 7 days.

**Delivery is at-least-once. We never claim exactly-once.** A crash after `XADD` and before the
acknowledgement leads to a second publish of the same UUID under a new stream entry ID. Consumers
deduplicate by event UUID (`EventDeduper`/`consumeOnce`, which remembers an event only after its
handler succeeds). Cache invalidation is idempotent by construction.

**Streams and privacy.** Owner events go to `pp:v1:events:user:{userId}`. Only the owner's reader
may read that stream; the reader also re-checks each envelope's audience. `quote.updated` goes to
`pp:v1:events:market` and contains only security IDs and timestamps. Ingestion writes one internal
`news.article.ingested` (system) event per article whose accepted metadata changed. System events
are never published. The dispatcher fans each one out in PostgreSQL into owner `news.available`
events. Interested owners are those with an open position in a non-archived portfolio, or a
watchlist entry. Each notification lists only that owner's portfolio IDs. Fan-out IDs are UUIDv5
of (source event, owner), inserted with `ON CONFLICT DO NOTHING`, and the source row is
acknowledged in the same transaction. Redelivery therefore cannot duplicate notifications.

**Cursors are not event IDs.** A cursor is the opaque string `v1.<epoch>.<redis-entry-id>`. The
epoch is a UUID stored in Redis. If Redis loses its data, the epoch changes and old cursors reset
instead of silently skipping entries.

**Retention.** User streams use `MAXLEN ~ 1000` and market streams `MAXLEN ~ 10000`. Both expire
after 30 days without a publish. The replay window is 7 days. `readEvents` returns
`reset` when the cursor is invalid, the epoch changed, the cursor is older than the window, or a gap
is possible. A gap is possible when `max-deleted-entry-id` is after the cursor (XDEL), or when
anything was removed and the cursor is older than the first retained entry (trimming). The
trimming rule is conservative: at the exact trim boundary it can reset unnecessarily, but it can
never skip an entry.

**Snapshot recovery.** `recoverySnapshot` (`GET /api/events/recovery`) captures the stream cursors
first, then reads the owner's PostgreSQL state. Any change committed after the snapshot is published
after the cursor and is replayed. Changes already in the snapshot may replay too, and UUID dedupe
absorbs them. Without Redis, the snapshot is still served with `null` cursors.

**Cache-aside.** Keys are prefixed `pp:v1:`; bump the version when a cached shape changes.
- Latest quote per security (global, no user data): 15 s ± 20 %. A missing quote is cached for
  5 s ± 20 %. The `quote.updated` event deletes the key.
- Owner news (all interests, or one portfolio): 60 s ± 20 %. The key contains the user ID in a
  hash tag, the owner's cache generation, the portfolio ID and the limit. Every owner event
  increments the generation (TTL 30 days). The TTL is only a backstop.
- The dispatcher invalidates **before** `XADD`. A client reacting to an event, or a snapshot read
  after its cursor, therefore never sees the pre-event cached value.
- Single-flight: an in-process promise map, then a Redis `SET NX PX 5000` lock released by a
  compare-and-delete script. Losers poll for up to 1 s and then load from PostgreSQL directly.
  Correctness never depends on the lock.
- Fail open: any Redis error, an absent `REDIS_URL`, or a 250 ms timeout falls through to PostgreSQL
  and skips Redis for 5 s. Loader errors and unauthorized (404) results are never cached.
- Not cached: portfolio summaries/valuation, ledgers and anything else financial. Those reads keep
  their consistent PostgreSQL snapshots.

## Alternatives considered

- *Publishing to Redis directly after commit (dual write):* loses events on a crash and needs
  compensation. Rejected.
- *Change data capture/logical decoding:* robust, but adds infrastructure (Debezium or a replication
  slot) that is out of scope for a laptop demo and AKS teaching path.
- *Publish-side Redis dedupe marker (`SET NX` + `XADD` in Lua):* this would hide most duplicates, but
  the marker itself can be lost (failover, eviction). Consumers would still have to be idempotent,
  and the course would imply a stronger guarantee than we have. Rejected.
- *One shared public stream filtered by readers:* any reader bug would leak another user's financial
  interests. Rejected in favour of owner streams plus a data-free market stream.
- *Fan-out inside the ingestion transaction:* the cost would grow with the number of users on the
  ingestion path. The separate idempotent fan-out keeps ingestion global and bounded.
- *Consumer groups (`XREADGROUP`):* deferred to milestone 14's SSE fan-out design. Each API
  instance needs independent readers, not shared group consumption.

## Consequences

- Every domain mutation must use the services, because they write the outbox. Legacy repository
  mutators now delegate to them.
- Events for one owner can be published slightly out of order across dispatcher replicas.
  Consumers treat events as hints plus `occurredAt` and refetch or reconcile snapshots. They do not
  apply blind deltas.
- Interest is evaluated at fan-out time, not at article time.
- The owner's own writes reach their cached news after dispatch latency (normally ≤ 1 poll
  interval), or at the latest after the TTL if dispatch is down.
- Watch for: a growing `DEAD` count, PENDING age, frequent `reset` responses (retention too small)
  and the cache `redisErrors`/`bypassed` counters.

## References

- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/ , XADD/XTRIM/XINFO STREAM
  command pages (checked 2026-10-02, server 7.4.5).
- node-redis 5.10.0 installed type definitions (`@redis/client/dist/lib/commands`).
- PostgreSQL 17 `SELECT … FOR UPDATE SKIP LOCKED`, `gen_random_uuid()`, `clock_timestamp()`.
- RFC 9562 (UUID version 5).
