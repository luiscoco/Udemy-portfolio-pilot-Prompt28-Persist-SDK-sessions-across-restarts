# 0008. Authenticated SSE fan-out across API instances

- Status: Accepted
- Date: 2026-10-02
- Milestone: 14

## Context

Redis Streams retain owner events and shared, data-free quote invalidations (ADR 0007).
An EventSource can send one Last-Event-ID, but recovery needs both stream positions.
A competing consumer group cannot broadcast to clients attached to different API pods.

## Decision

Each API process independently polls retained stream ranges through the existing shared Redis
client. Reads are nonblocking, with a 500 ms interval after each completed poll. Within a poll,
identical scope/cursor cohorts share a read promise and fan out locally. Market reads also share
across owners at the same position. Replaying connections can read different positions without
delaying connected clients. No consumer groups, stream acknowledgements or per-browser Redis
connections are used. The worst case is one user and one market range read per local client per
poll; the hard admission bound is 256 clients per process and 16 per owner. This favors a simple,
correct bounded design now; milestone 30 should measure command load before increasing limits.

`GET /api/events/recovery` captures the existing raw positions before its authorized PostgreSQL
snapshot and adds a signed `cursor`. The opaque `s1` cursor contains both positions, authenticated
with HMAC-SHA256 using AUTH_SECRET, domain-separated and bound to the current session's user ID.
It grants no access: every connection must also authenticate via the HttpOnly cookie. All pods
must share AUTH_SECRET. Local development without it shares a random process key; another process
or a restart resets such cursors. The old `streams` fields remain for compatibility and diagnostics;
only the signed `cursor` is accepted by SSE. Cursor possession is neither a bearer credential nor
permission to change stream scope. No user IDs or tokens are accepted in the URL.

Last-Event-ID overrides the cursor query parameter on automatic reconnection. Invalid, foreign,
expired, trimmed or changed-epoch cursors emit `stream.reset`, clear the SSE ID and close. A fresh
connection also resets, requiring a snapshot before streaming. Recovery remains cookie-authenticated
at the fixed `/api/events/recovery` path; a null recovery cursor means Redis is unavailable.

Each client gets a 64 KiB byte queue, reserving 512 bytes for a slow-client reset. Overflow sends
the reset and closes rather than accumulating unbounded data. The queue may drain already accepted
frames before the reset; clients must close their EventSource and replace their state with a fresh
snapshot. Heartbeat comments occur every 15 seconds. Revalidation checks current database sessions
every 30 seconds with a 2 second deadline; known session expiry has its own timer. Revocation can
therefore take up to 32 seconds to close an established connection. Failed checks close fail-closed.
Aborts and body cancellation remove subscriptions, listeners and timers, without cancelling agent runs.
Redis operations also have a 2 second deadline; a timeout resets and releases clients. A timed-out
underlying Redis command is not itself cancelled; no further poll starts for released subscriptions.

Public DTOs are separate strict Zod schemas. Projection removes audience/owner IDs, source-event
IDs and internal entity metadata. Only public change notifications and the data-free market
invalidations are produced now. Agent event contracts allow visible text and enum progress;
agent publishers arrive in milestones 18–19. They must explicitly project authorized run state
through those contracts, never forward arbitrary SDK messages, tool arguments or error strings.

## Alternatives considered

- One shared consumer group: incorrect, as it distributes each entry to one pod.
- One blocking connection per browser: correct delivery but unnecessary connection growth.
- Dedicated readers and a process replay ring: useful at higher scale, but requires another
  bounded retention layer and coordination between replay and live delivery.

## Consequences

Transport cursors and event UUIDs remain distinct. The hub suppresses repeated UUIDs within a
connection using a bounded 2,000-ID set. Reconnection/snapshot duplicates remain legal and the
frontend must deduplicate by UUID (milestone 15). Default `message` frames carrying `{}` advance
the cursor over duplicates without another named application event. Cross-stream ordering is not
promised. PostgreSQL remains authoritative. Heartbeats measure browser transport health, not
upstream market freshness. Ingress must disable buffering/transformation and allow long requests;
that deployed configuration is deferred to milestone 35.

## References

Checked 2026-10-02 against official docs and installed Next.js 16.3.8 route guide/types and Better
Auth 1.7.7 getSession types (disableCookieCache).

- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Redis XRANGE](https://redis.io/docs/latest/commands/xrange/)
