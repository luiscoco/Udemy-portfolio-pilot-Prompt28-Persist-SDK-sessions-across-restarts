# 0020. Durable agent jobs and attempt fencing

- Status: Accepted
- Date: 2026-10-03
- Milestone: 27

## Context

The API-owned coordinator could not survive an API restart and could not distinguish a remote
worker from a lost callback. SDK queries can incur cost and approved application mutations before
their final result is committed. Replaying all expired leases would therefore be unsafe.

## Decision

The API commits an authenticated, budget-reserved queued AgentRun and user message; it does not
launch chat execution. The agent worker independently claims PostgreSQL work. A short transaction
locks an eligible Conversation with FOR UPDATE SKIP LOCKED, locks its queued run, increments its
job attempt, and stamps both durable leases. A partial unique index includes queued, running and
waiting_for_approval states; overlapping submissions return 409 rather than silently queueing
multiple turns against the same session. SDK attempts remain a separate usage counter.

Thirty-second leases use database time, with heartbeats every five seconds and a 500ms idle poll.
Workers hold no long-lived SQL transaction while calling the SDK or waiting for human permission.
All result, progress, session-binding and approved-mutation writes require the matching worker
owner, job attempt and unexpired run/conversation leases. Approval decisions are authenticated API
operations and reject an expired execution lease; consumption is independently fenced and uses
its existing one-time mutation receipt. Cancellation is durable, checked by heartbeats, and
invalidates pending/granted approvals immediately. Queued cancellation completes without a query
or charge. No browser/request signal cancels the job.

Recovery rechecks expiry under conversation-then-run locks. A claim abandoned BEFORE its durable
execution-start marker, with no chunks or proposals, may return to queued, up to three claims.
Every other abandoned attempt becomes failed/interrupted, with a visible explanation, one final
message/outbox outcome, invalidated unused approvals and conservative budget accounting. Legacy
active API runs are explicitly marked as having begun in the migration. The user may submit a
new request after recovery, with new approvals; we do not automatically replay a paid or partially
mutating query. Structured validation/resume fallbacks retain usage checks and are also forbidden
after any mutation proposal. Previously consumed mutation receipts remain committed.

Visible text is coalesced at 150ms/1024 characters, split at 8192 characters, and stored as typed,
sequenced AgentRunChunk events. Each batch commits with its outbox row. A run has at most 512
progress events/256KiB of progress, plus two authoritative terminal events. The final message,
budget reconciliation, lease release, approval invalidation and terminal journal/outbox entries
commit in one transaction. UUIDs derive from run and sequence; Redis delivery remains at-least-once.
GET /api/runs/{id}/chunks returns only the authenticated owner's sanitized browser events.
The browser reads the bounded journal every two seconds while a run is tracked, rebuilds drafts
after reload/gaps, and replaces them with the authoritative message without appending duplicates.

## Alternatives considered

Redis-only jobs would lose the authoritative durability and approval/budget transaction boundary.
A global in-memory lock cannot coordinate replicas. Automatic SDK replay after lease expiry cannot
prove that earlier cost or side effects did not occur. Holding a database transaction throughout a
human approval would retain row locks and connections for too long.

## Consequences

An API restart no longer stops chat. A worker outage delays queued work; a begun run fails honestly
after lease expiry when an available worker performs recovery. Each worker executes one job at a
time, so recovery cadence also depends on available worker capacity. Lease loss cannot stop an
external provider instantly, but it prevents stale durable writes and approved mutations. SDK
session artifacts remain host-local until milestone 28. Fleet limits, monitoring, retention/admin
controls and distributed shutdown scenarios remain milestone 30. No cloud deployment is included.

## References

Checked 2026-10-03: [PostgreSQL 17 SELECT locking clauses](https://www.postgresql.org/docs/17/sql-select.html)
and [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions).
Installed Prisma 7.10.0 generated types support tagged $queryRaw/$executeRaw and interactive
transactions. Installed Next.js 16.3.8 route-handler guides and Claude Agent SDK 0.3.276 query,
abortController and Query.close types were read; execution preserves those existing SDK APIs.
This decision supersedes the execution ownership portions of ADRs 0011/0012/0013/0018.
