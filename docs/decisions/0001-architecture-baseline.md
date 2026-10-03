# 0001. Architecture baseline

- Status: Accepted
- Date: 2026-09-30
- Milestone: 00

## Context

PortfolioPilot is a teaching project that has to run fully in mock mode on a laptop. It also has to
show a production path on Azure. It combines financial record-keeping, where correctness and
ownership are critical, with a Claude Agent SDK assistant that reads untrusted news and runs for a
long time.

## Decision

- **One frontend:** React + Vite SPA (`apps/web`). Next.js (`apps/api`) is used only for Node.js
  Route Handlers, with no UI and no Server Actions.
- **Separate worker process** (`apps/worker`) with selectable roles (ingestion, outbox dispatch,
  agent runs). Long agent runs do not live in API request lifetimes.
- **Shared packages:** browser-safe `contracts`; pure `domain`; server-only `db`, `providers`,
  `agent`, `config`, `observability`.
- **PostgreSQL is authoritative** for all business data, durable jobs, and run state. **Redis** holds
  only caches, replayable event streams, and transient coordination, all rebuildable from PostgreSQL.
- **Single origin:** `/api/*` goes to Next.js and everything else to static web assets. Locally, the
  Vite proxy does this, which avoids credentialed CORS.
- **Application-defined events** go to the browser over SSE. Raw SDK messages never do.
- **Azure target:** AKS, ACR, PostgreSQL Flexible Server, Azure Managed Redis, Key Vault, and Blob
  Storage for session artifacts.

## Alternatives considered

- *Next.js as the full-stack UI:* rejected. The course teaches a clear SPA/API boundary and keeps
  server code out of browser bundles.
- *Running agents inside API requests:* acceptable only as a temporary step (milestones 04 and
  18–26). It is replaced by durable worker execution in milestone 27.
- *Redis as the job queue of record:* rejected. Durable job state stays in PostgreSQL so it survives
  Redis loss.
- *WebSockets:* not needed because traffic is server-to-client only. SSE works through standard HTTP
  gateways and supports `Last-Event-ID` replay.

## Consequences

- More packages and build-order configuration up front.
- Event delivery is at-least-once, so consumers must be idempotent (milestone 13).
- SSE fan-out across several API pods needs a deliberate design (milestone 14).

## Clarification (2026-10-02, milestone 13)

The decision is unchanged. [ADR 0007](0007-cache-outbox-and-redis-streams.md) makes the Redis role
and event guarantees concrete:

- Domain events are written as `OutboxEvent` rows in the same PostgreSQL transaction as the change.
  A separately selectable worker role (`outbox`) publishes them to Redis Streams with durable
  lease claims, fenced acknowledgements and bounded retry.
- Delivery is **at-least-once**, never exactly-once. The event UUID is the stable domain identity
  and consumers deduplicate on it. Redis stream entry IDs are only opaque delivery cursors.
- Streams are bounded (length + idle expiry + 7-day replay window). An expired, trimmed or
  foreign-epoch cursor resets to a PostgreSQL snapshot.
- Private events go only to per-owner streams. The shared market stream carries no user data.
  Article ingestion stays global; owner notifications are created by an idempotent fan-out.
- Redis caches (quotes, owner news) are cache-aside, versioned, jittered, single-flight and fail
  open to PostgreSQL. Financial calculations are not cached.

## References

Official documentation is verified per milestone and recorded in `docs/versions.md` and later ADRs.
