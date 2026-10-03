# 0019. Agent limits, usage accounting and daily reservations

- Status: Accepted
- Date: 2026-10-03
- Milestone: 26

## Context

Interactive AgentRun execution is still local to one API process. PostgreSQL must protect a
user's daily allowance across concurrent conversations and API replicas, independently of the
local concurrency coordinator. A lost process may have spent money without returning telemetry.
An SDK cost estimate is not an invoice, and its response may cross a configured cost threshold.

## Decision

Model identifiers remain in validated server configuration. Record the runtime's init model and
then the actual main assistant message model, rather than pretending the configured alias is the
resolved model. Persist the final reported model, usage classification and totals with both the run
and its authoritative assistant message. Public events still contain only application DTOs.

Use documented SDK maxTurns/maxBudgetUsd plus application checks. Server settings bound UTF-8
current prompt plus system instruction bytes, serialized tool response bytes, main model turns,
whole-run wall time and estimated cost. The application also detects main round trips by unique
assistant message ID. The watchdog races application dependencies and SDK reads; abort and
Query.close release the live subprocess. Browser disconnection still does not cancel a run.
Structured validation/reseed attempts share one cost/turn allowance and one wall-clock deadline.
An attempt without reliable final telemetry prevents further paid retries.

Read total_cost_usd once per query result, including error results, as an **estimate**. Read
modelUsage for whole-tree tokens: it already includes subagents, so never add child assistant
usage to it. Partial events are not an accounting input. Multiple reports for the same attempt
replace each other; returned usage replaces the callback, rather than adding it again. Per-message
input/output/cache observations are only an early resource guard (output may be a placeholder).
They are never added to result totals. Billed cost remains unknown: authoritative billing would
require Anthropic's separate Usage and Cost API, which this milestone does not integrate.

The pinned SDK 0.3.276 / CLI 2.1.276 declares per-query totals, including on resume. Official docs
now describe restored session totals starting at CLI 2.1.277. Use the installed version's semantics;
reject an unexpected runtime version on resume. No baseline subtraction is invented, no dependency
is upgraded. A future SDK migration must explicitly test its new accounting lifecycle.

Before starting work, insert/update the owner's UTC-day DailyAgentBudget row using PostgreSQL
ON CONFLICT DO UPDATE with a conditional charged + reserved + new reservation <= daily limit.
The statement locks the shared ledger row. It commits in the **same transaction** as the user
message and AgentRun, after owner authorization. A rejected reservation returns 429
BUDGET_EXHAUSTED without creating a run, publishing a run-start event or leaving a message.
The daily allowance includes every outstanding reservation, independent of model/mode selection.

Reserve max run estimated cost plus a configurable overflow allowance (defaults $0.10 + $0.10).
Use exact integer microdollars and PostgreSQL numeric(18,6); parse SDK numeric estimates through
their decimal representation, round charges/reservations upward and daily allowance downward.
Convert to a JS number only at the SDK option boundary. JSON money is always a decimal string.

The exactly-once terminal run transaction releases its reservation and charges the final SDK
estimate. Known overruns are charged even when larger than the reservation, so later requests
cannot ignore them. Mock runs charge zero and explicitly report simulation. With missing, crash,
zeroed error_during_execution or incomplete attempt telemetry, charge at least the full reserved
amount (or known cost if larger). The remaining reservation is never released merely because
the API process disappeared. Owner access/stale reconciliation or orphan cancellation moves that
reservation to conservative charged usage atomically with the terminal outcome. There is no
automatic retry or refund after a crash. Before recovery, the outstanding reservation still blocks
admission. Keep the original UTC day when a run finishes after midnight; new requests use DB UTC
time. This is an application quota ledger, never a bill to the user.

Reset context periodically by starting a new session with an explicit application summary.
Fetch owner-scoped saved history across pages (with an explicit 1,000-message safety boundary).
Retain every validated source reference, original source URL/publication timestamp/synthetic label,
and exact saved user requests that may specify portfolio scope. Recent analysis excerpts are
bounded and omitted/excerpted turns are labeled. Historical analysis is not fresh market data:
re-read holdings, quotes and news before relying on it. Always include the current request and the
conversation's unchanged portfolio scope. A summary/prompt or full-scope lookup that cannot fit
fails visibly; it does not silently select fewer portfolios or discard source references.

## Alternatives considered

An in-memory daily counter cannot protect replicas or restart recovery. Reserving after execution
admits excessive concurrent spend. Releasing abandoned reservations assumes a crash was free.
Summing partial and result usage or subagent and model totals inflates usage. Sending only the
last message page loses old sources and requested scopes. Silent summary truncation can change
the question. SDK estimates cannot provide a hard ceiling on authoritative billed dollars.

## Consequences

The UI identifies cost estimates, mock zero-cost runs, retained uncertain reservations, context
resets, timeouts, size/turn/cost limits and explicit cancellation. Terminal events and durable
messages resolve the existing SSE/polling flow. Reservations are durable even though execution,
session files and approval callbacks remain local until milestones 27/28/30. Conservative crash
charges can reduce the day's available quota; an audited correction policy is future operational
work. The SDK cap and overflow reserve reduce exposure but do not guarantee an invoice ceiling.
The ledger here covers interactive AgentRun requests and their retry/subagent tree; the separately
cached public article-analysis service retains its existing service-level caps, rather than charging
that shared cache computation to an arbitrary user's private daily ledger.

## References

Checked 2026-10-03 against installed SDK 0.3.276 sdk.d.ts (Options, SDKSystemMessage,
SDKAssistantMessage, SDKResultSuccess/SDKResultError, HookInput) and Prisma 7.10.0 generated
transaction types. All fifteen migrations applied to a fresh PostgreSQL test database.

- [Official cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking), especially
  estimate vs billing, modelUsage/subagent scope, deduplication, crash results and the 2.1.277 change.
- [Official TypeScript SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript).
- [Official session documentation](https://code.claude.com/docs/en/agent-sdk/sessions).
- [PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html).
