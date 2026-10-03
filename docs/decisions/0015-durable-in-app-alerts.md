# 0015. Durable recommendations and in-app alerts

- Status: Accepted
- Date: 2026-10-02
- Milestone: 22

## Context

Redis/SSE delivery is at least once. Replaying an event must not create another research action or
notification. Notifications, dismissals and history must survive Redis loss and browser reconnection.

## Decision

Recommendation evidence status remains separate from user disposition (`new`, `saved`, `dismissed`).
Recalculation never resets disposition. Only insertion of a new recommendation identity emits
`recommendation.created`; repeated deliveries reuse its identity and shared analysis.

`AlertRule` belongs to the session owner. Edits increment its revision, deletion soft-deletes the
rule, and existing notification history remains. Watched securities must be in the owner's current
holdings/watchlist. Empty filters mean all relevant news; category/security lists use OR internally,
and the separate filters combine with AND. Numeric concentration and relevance thresholds use exact
decimal comparisons with inclusive boundaries. Concentration means largest affected holding weight
within its portfolio; relevance means affected value divided by all active portfolio value. Both use
the research exposure basis, explicitly labeled as market value or cost basis. Null exposure cannot
satisfy a numeric threshold, including zero. Category classification can be model-produced; numeric
comparison, deduplication, cooldowns and private recommendation generation are deterministic.

The outbox worker processes durable `news.available` events before acknowledging them. The internal
owner capability is minted only from a stored owner-scoped news event, never a browser/model user ID.
It rechecks current interests before analysis, reuses the public analysis cache, persists private
recommendations, then evaluates alerts. No browser read or reconnect triggers analysis. An empty
recommendation view honestly shows no relevant news requiring research.

Notification uniqueness is `(ownerId, ruleId, ruleRevision, articleId, eventRevision)`, where the
event revision is the accepted article content hash. PostgreSQL row locks serialize cooldown
decisions and rule edits. Evaluation also locks the article and rejects superseded analyses.
Cooldowns use evaluation time, apply across rule edits, and persist suppressed decisions so later
replay cannot turn them into visible alerts. Suppressed rows do not enter the in-app history or SSE.
One notification can reference multiple research actions; it is not one notification per card.

Visible notification creation and dismissals append an owner-only `research.updated` event in the
same transaction. SSE exposes only resource identity and change kind; the browser refetches private
PostgreSQL APIs. The existing UUID event deduper and signed owner-bound cursors handle redelivery.
Snapshot recovery invalidates alert rules, notifications, article impact and recommendation reads.
There is no email, third-party messaging, trade execution or agent-driven rule mutation.

## Consequences

The existing outbox retry/lease/dead-letter policy also covers research work. Shared model execution
is lease-fenced, notification decisions are transactional, and a retry after either write reuses it.
Live model latency and retries may delay news delivery or exhaust the dispatcher retry budget; operators
can requeue the durable DEAD event after addressing its cause. Independent durable agent execution
remains milestone 27. Alert evaluation is news-triggered: changing a threshold alone does not
retroactively notify about every stored article, and quote-only changes do not trigger a news alert.
History retains rows but the current API/UI bounds reads to 50 recommendations and 100 notifications.

## References

Verified on 2026-10-02 against installed Prisma 7.10.0 generated models/transaction types and
Next.js 16.3.8 `node_modules/next/dist/docs/.../route.md`:

- [Prisma v7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions)
- [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- ADR [0007](0007-cache-outbox-and-redis-streams.md), [0008](0008-authenticated-sse-fanout.md),
  [0014](0014-shared-analysis-private-research.md).
