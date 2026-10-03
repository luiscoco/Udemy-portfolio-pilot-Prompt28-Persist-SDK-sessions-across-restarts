# Architecture Decision Records

Record every significant, hard-to-reverse choice here: library selection, provider choice, data
model trade-offs, delivery guarantees, security boundaries, and deployment topology.

## Conventions

- File name: `NNNN-short-kebab-title.md`, numbered sequentially and never renumbered.
- Status: `Proposed`, `Accepted`, `Superseded by NNNN`, or `Deprecated`.
- Do not rewrite an accepted ADR's decision. Supersede it with a new ADR and link both ways.
  Clarifications and "consequences observed" notes may be appended with a date.
- Reference official documentation with the version and date checked. Never cite an API, version,
  or Azure SKU that has not been verified.

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Milestone: NN

## Context
What forces are at play: requirements, constraints, verified facts.

## Decision
What we chose, stated plainly.

## Alternatives considered
Options rejected and why.

## Consequences
Positive, negative, and follow-up work. How we would detect that the decision is wrong.

## References
Official documentation (with version and date checked).
```

## Index

| # | Title | Status | Milestone |
| --- | --- | --- | --- |
| [0001](0001-architecture-baseline.md) | Architecture baseline | Accepted | 00 |
| [0002](0002-database-ledger-and-auth.md) | Database identity, ledger and auth schema | Accepted | 06 |
| [0003](0003-authentication-and-sessions.md) | Better Auth sessions and Entra sign-in | Accepted | 07 |
| [0004](0004-transaction-correction-and-concurrency.md) | Transaction correction and concurrency | Accepted | 08 |
| [0005](0005-exact-valuation-and-quote-policy.md) | Exact valuation and quote policy | Accepted | 09 |
| [0006](0006-alpaca-and-durable-ingestion.md) | Alpaca adapters and durable ingestion | Accepted | 12 |
| [0007](0007-cache-outbox-and-redis-streams.md) | Cache-aside, transactional outbox and Redis Streams delivery | Accepted | 13 |
| [0008](0008-authenticated-sse-fanout.md) | Authenticated SSE fan-out across API instances | Accepted | 14 |
| [0009](0009-news-reading-and-correction-provenance.md) | News reading and correction provenance | Accepted | 16 |
| [0010](0010-authorized-agent-tools.md) | Authorized read-only agent tools | Accepted | 17 |
| [0011](0011-grounded-chat-local-coordination.md) | Grounded chat and local coordination | Accepted | 18 |
| [0012](0012-streamed-agent-runs.md) | Streamed agent runs, reconciliation and explicit cancellation | Accepted | 19 |
| [0013](0013-resumable-sessions-structured-analysis.md) | Resumable conversation sessions and validated structured analysis | Accepted | 20 |
| [0014](0014-shared-analysis-private-research.md) | Shared article analysis and private portfolio research | Accepted | 21 |

| [0015](0015-durable-in-app-alerts.md) | Durable recommendations and in-app alerts | Accepted | 22 |
| [0016](0016-bounded-specialists-and-research-mcp.md) | Bounded specialists and external research MCP | Accepted | 23 |
| [0017](0017-managed-application-skills-and-audit.md) | Managed application skills and policy audit | Accepted | 24 |

| [0018](0018-durable-approvals-and-cancellation.md) | Durable approvals and explicit cancellation | Accepted | 25 |
| [0019](0019-agent-limits-and-daily-reservations.md) | Agent limits, usage accounting and daily reservations | Accepted | 26 |
| [0020](0020-durable-agent-jobs.md) | Durable agent jobs and attempt fencing | Accepted | 27 |
| [0021](0021-private-session-checkpoints.md) | Private SDK completed-turn checkpoints | Accepted | 28 |

### Expected upcoming ADRs

| Milestone | Topic |
| --- | --- |
| 01 | Toolchain and pinned version set |
| 07 | Authentication library and session strategy |
| 08 | Transaction correction and concurrency policy |
| 12 | Live quote/news provider selection |
| 13 | Outbox, Redis Streams, and delivery guarantees |
| 14 | SSE fan-out across API instances |
| 27 | Durable agent run execution and fencing |
| 28 | SDK session artifact persistence |
| 29 | Threat and execution trust boundary |
| 35 | AKS gateway/ingress controller |


