# 0011. Grounded chat with local coordination

- Status: Accepted
- Date: 2026-10-02
- Milestone: 18

## Context

Milestone 17 supplies owner-bound read-only SDK tools. Chat needs durable application messages,
an evidence boundary, and bounded execution before the durable worker in milestone 27.

## Decision

Persist Conversation and ChatMessage in PostgreSQL. Repository contexts come from the current
session and every conversation/message query includes ownership. Conversation DTOs omit owner IDs;
message DTOs omit internal sequence numbers. Pagination uses an owner-validated conversation ID
anchor ordered by creation time/ID, and a conversation-validated message ID anchor ordered by a
monotonic database sequence. Return messages chronologically within each newest-first page.

An optional portfolio ID is an immutable research scope, verified at creation and again by tools
on each run. It is a scope hint rather than a foreign key: a removed/unavailable portfolio yields a
sanitized failed turn, never broader fallback access. Conversation history includes at most eight
completed messages clipped to 2,000 characters each. Encode request/context as JSON data; supply
`portfolio-research-v1` as a separate custom SDK `systemPrompt`. JSON delimiters alone are not a
security mechanism: repositories, strict schemas and SDK tool permissions enforce the boundary.

For largest-holding research, invoke authorized summary/holdings tools with at most 20 holdings
pages. The pure domain ranks aggregate USD security exposure using exact decimals. Withhold the
ranking for missing/stale valuations, truncated scope or an exhausted page budget. Ties require
clarification. Recent defaults to seven days; the deterministic mock searches the selected security,
filters publication timestamps and security IDs, and inspects details for cited articles.

Collect source metadata only after successful `getNewsArticle` tool calls. Validate HTTP(S) URLs
without embedded credentials; browser links must match this per-run registry. React implements a
small Markdown subset with escaped text, headings, unordered lists, bold, inline code and validated
links. No raw HTML, images or automatic links. The registry establishes source provenance, not
semantic truth; structured claim/reference validation is milestone 20.

Use a replaceable `RunCoordinator.execute(ownerKey, conversationId, callback)` interface with an
application-owned AbortSignal. The process-local implementation admits four active turns globally,
two per account and one per conversation, rejecting excess requests instead of queuing. A 90-second
watchdog aborts the SDK and prevents subsequent tool calls. Keep admission reserved until actual
work settles when a dependency ignores abort; this prevents unbounded background work. Live SDK
runs retain their 60-second, six-turn and USD 0.10 ceilings. Browser disconnects do not cancel.

Persist the user message before execution and a sanitized completed/failed assistant message after
execution. Only public answer text, approved source metadata, mode, timestamps and instruction
version cross the browser boundary. Remove the old demo Q&A endpoint, DTOs and unused adapters.

## Alternatives considered

An in-memory transcript loses completed answers on restart. Immediate durable jobs would preempt
milestone 27. A general HTML/Markdown rendering pipeline adds unnecessary dependencies and a
larger surface for this slice. Passing raw SDK messages to React violates the application boundary.

## Consequences

This requires exactly one API process; do not scale replicas or rely on locks across restarts.
Completed messages survive restart, in-flight runs do not. A crash can leave a user message without
an assistant reply. No automatic replay, SDK session resumption, message streaming, request
idempotency or explicit cancellation is claimed here. Refresh before retrying an uncertain POST.
An uncooperative dependency can retain an admission slot until it settles or the process restarts.

The mock is a bounded deterministic demonstration, not a general language model; it does not use
history to resolve arbitrary follow-ups or arbitrary custom research windows. The live SDK receives
the bounded history as data in a fresh session. Live model behavior still needs credentialed testing.

## References

Checked 2026-10-02 against installed SDK 0.3.276 `sdk.d.ts` (`systemPrompt`, `query`,
`abortController`), Prisma 7.10.0 generated types, and Next.js 16.3.8 installed `route.md`
(Promise-valued dynamic params).

- [Custom system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [SDK custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- [Prisma 7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions)

## Consequences observed (2026-10-02, milestone 20)

Bounded history is now sent only when no SDK session handling applies; resumed turns rely on the SDK session and reseeded turns receive an explicit application summary. See [0013](0013-resumable-sessions-structured-analysis.md).
