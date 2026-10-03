# 0014. Shared article analysis and private portfolio research

- Status: Accepted
- Date: 2026-10-02
- Milestone: 21

## Context

News ingestion is global and delivers duplicates and corrections. Holdings belong to a session-derived
owner. Running a portfolio-aware model on each delivery would waste money and make a shared cache a
privacy risk. Milestone 20's conversational analysis remains separate: it can contain private context.

## Decision

Use two layers. A tool-less Claude Agent SDK query (or deterministic mock) classifies public headline
and summary fields into `article-analysis-v1`. Domain rules combine its validated result with authorized
holdings to calculate private impact and research steps. There is no trade operation.

PostgreSQL `ArticleAnalysis` is the authoritative shared cache. Its key hashes article ID, accepted
content revision, prompt/schema versions and model configuration. The revision hashes title, summary,
canonical URL, publication time, linked symbols, accepted provider and synthetic status. Duplicate
provider record IDs or observation timestamps alone do not invalidate content. The accepted observation's
provider is checked; the canonical article's original provider cannot authorize a later unsupported source.

The cache contains no owner, holdings, weights or private conclusions. PostgreSQL `PortfolioImpact`
and `Recommendation` are owner-scoped. Recommendation provenance records evidence revisions and analysis
IDs, versions, a portfolio fingerprint and the UTC calculation time. APIs return `Cache-Control: no-store`.

Shared cache insertion/claim is atomic with a unique key. A 90-second lease renews every 30 seconds
while the bounded analyzer runs; a UUID token fences completion. A caller waits at most five seconds
for another process, then returns pending. Process-local single-flight is scoped to the database client.
Validation gets two attempts total. Failures wait ten minutes before another analysis attempt. A crashed
process loses its lease; later requests can reclaim it. A DB outage can still cause overlapping model
work after lease expiry, but an old token cannot replace the new result. Durable worker execution remains
milestone 27.

Exposure uses exact rational decimal arithmetic and string outputs. Use market value only if every
open holding has a fresh quote; otherwise use cost basis consistently for all portfolios. The aggregate
denominator is all active portfolios, while individual holding weights use their own portfolio total.
Zero totals give null weights. Concentration review begins at 20% of a holding's portfolio.

`monitor_event`, `review_concentration`, `read_primary_source`, and `reassess_assumptions` are deterministic
research steps. Each has rationale, validated evidence facts, holdings/securities, uncertainties,
counterarguments, reporting tone and an as-of time. Neutral immaterial news can yield no recommendation.
Opposing tone in already-analyzed articles within seven days prompts comparison; it does not establish
which report is true. Related analysis is bounded to five candidate articles and never starts extra model
runs. Reading a primary source is a suggestion; no new URL is invented.

## Invalidation policy

| Change | Behavior |
| --- | --- |
| Accepted article correction | In the ingestion transaction, supersede other-revision analyses and mark all citing recommendations stale. Read-time revision checks also detect direct changes. |
| Article merge/removal | Retain recommendations with withdrawn/unavailable evidence; shared analysis and impact rows follow their article foreign keys. |
| Trade, portfolio create/archive/rename, watchlist membership | Recheck a fingerprint of active portfolio IDs/names, ordered immutable transaction IDs and watchlist IDs on each read. A sell/rebuy cannot evade invalidation by restoring net quantity. |
| Prompt, schema, model configuration or generator version | Mark existing private results stale on read. A new shared configuration key runs the analyzer once; generator changes need only deterministic recalculation. |
| Evidence older than 72 hours | Label each evidence item aged on read. Historical evidence is retained, not silently treated as current reporting. |
| Quote changes or passage of time alone | Persisted weights remain snapshots with `computedAt`/`asOf`, not live allocations. Explicit recalculation obtains current quote status/values without rerunning cached analysis. |
| New related analysis | Compare it on the next explicit recalculation. No background model fan-out. |

GET is read-only with respect to model execution. POST recalculates from current inputs; old
recommendations become superseded, while unchanged identities update the as-of snapshot. Holdings are
fingerprinted before summaries are read and checked again when presented, so intervening trades leave
the result stale. Corrections are checked under an article lock before private persistence. SSE notifications
refresh private research reads on portfolio, watchlist and article changes; stream recovery includes them.

## Alternatives considered

- Shared portfolio-aware model results: rejected because private conclusions cannot be shared safely.
- A model recommendation per duplicate delivery: rejected for cost and irreproducible exposure.
- Redis as the only cache: rejected because analysis/provenance and claim state must survive eviction.
- Automatic analysis of every related article: deferred; this milestone uses previously validated cache entries.

## Consequences

Recommendations are reproducible and cheap to refresh. Provenance and stale evidence remain inspectable.
The provider allowlist is not an assertion that a report is true. Source validation rejects extra IDs,
URLs and unknown symbols; it cannot semantically prove every model paraphrase. Prohibited price-target,
trade, certainty and probability wording is rejected in analyzer fields, including key facts. Sentiment
is explicitly neither a forecast nor a calibrated probability. Save/dismiss and configurable alerts are
milestone 22.

## References

Checked 2026-10-02 against installed Claude Agent SDK 0.3.276 `sdk.d.ts`, Prisma 7.10.0 generated client,
and Next.js 16.3.8's installed Route Handler guide. No dependency upgrades.

- [Claude Agent SDK structured output](https://code.claude.com/docs/en/agent-sdk/structured-outputs): `outputFormat`, draft-07 and `structured_output`.
- [Prisma v7 raw queries](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries): parameterized tagged templates and transaction queries.
