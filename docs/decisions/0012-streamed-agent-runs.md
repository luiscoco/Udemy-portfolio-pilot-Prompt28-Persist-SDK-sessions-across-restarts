# 0012. Streamed agent runs, reconciliation and explicit cancellation

- Status: Accepted
- Date: 2026-10-02
- Milestone: 19
- Amends: [0011](0011-grounded-chat-local-coordination.md) (the synchronous `POST …/messages` turn is replaced by runs)

## Context

Milestone 18 answered synchronously and returned the finished text. Users need progress, but a
naive stream shows the answer twice: once as partial deltas and again when the SDK delivers the
completed message (and a third time if `result.result` is appended). Verified in the installed
`@anthropic-ai/claude-agent-sdk` 0.3.276 `sdk.d.ts` (2026-10-02):

- `Options.includePartialMessages` emits `SDKPartialAssistantMessage` (`type: 'stream_event'`)
  wrapping Messages API stream events (`message_start`, `content_block_start/delta/stop`, …).
- Completed `SDKAssistantMessage`s share the API `message.id`; when streamed, each typically
  carries one content block. `result.result` repeats the final text.
- `Options.abortController` ("when aborted, the query will stop and clean up resources") and
  `Query.close()` ("terminates the underlying process … MCP transports") are documented.
  `Query.interrupt()` is documented only for streaming input mode, which this adapter does not use.

## Decision

**Application events, not SDK messages.** `SdkStreamMapper` (packages/agent) converts SDK
messages into `text.delta`, `block.completed` and `tool.status`. Text deltas build a draft; the
completed assistant block is authoritative and is emitted once as `block.completed`, matched to
drafts of the same API message in order. `result.result` is used only when no text block was seen.
Thinking, tool input deltas, tool results, subagent frames and SDK IDs are never surfaced; tool
names map to a six-name allowlist plus `other`. SDK failures become fixed codes.

**One assistant message per run.** The API pre-allocates the run ID and the assistant message
ID. Block (`<messageId>.bN`) and tool-call (`<messageId>.tN`) IDs derive from it. Each event
carries a per-message `sequence`, contiguous from 0, and a UUIDv5 of (run, sequence). A
redelivered event keeps its identity. Deltas carry the character `offset` within their block.
Browser and Redis events are typed: `agent.run.started`, `agent.text.delta`,
`agent.block.completed`, `agent.tool.status`, `agent.message.completed` (the persisted message)
and `agent.run.completed`.

**Delivery.** Agent events go directly to the owner's Redis stream, not through the PostgreSQL
outbox. They are transient notifications, and the authoritative outcome is in PostgreSQL. Deltas
are batched (150 ms or 1,024 chars), so an answer adds tens of entries to the ~1,000-entry owner
stream. Publication is sequential. A failed publish leaves a sequence gap rather than a reordering.
Agent events do not bump the owner's cache generation.

**Race-free handshake.** `POST /api/conversations/:id/runs` captures the owner/market stream
positions *before* the run row exists. It returns `202 { run, userMessage, replayCursor }`.
Every event of the run is strictly after that cursor. The browser's existing SSE connection
already predates the POST. If a snapshot recovery replaced its cursor meanwhile, or none exists
yet, `StreamManager.ensureReplay` reconnects from `replayCursor`. Duplicates are harmless: UUID
dedupe, idempotent invalidations, and sequence/offset checks.

**Reconciliation in the browser.** A pure reducer ignores sequences below the expected one. A
higher sequence is a gap: open drafts are marked incomplete and are never presented as whole.
Deltas apply only at their exact offset. `block.completed` and `message.completed` replace drafts.
The UI renders the persisted message under the same ID, so the answer appears exactly once.

**Durability and recovery.** `AgentRun` (`running|completed|failed|cancelled`, failure code,
cancel request time) is created with the user message in one transaction. A partial unique index
allows one running run per conversation. The only terminal transition is a conditional update in
the same transaction that inserts the assistant message (`completed|failed|cancelled`). Concurrent
finishers lose and publish nothing. Reload/reconnect recovers from
`GET /api/conversations/:id/runs/active`, `GET /api/runs/:id` and the messages list. The browser
polls the active run while one exists, as a fallback for lost events. Runs older than 120 s that
this process does not hold are finished as `failed/interrupted`.

**Cancellation.** `POST /api/runs/:id/cancel` (owner-scoped, origin-checked, idempotent, 202)
records `cancelRequestedAt` and aborts the local run with reason `cancelled`. The live adapter
forwards that to `abortController` and races every iterator read against abort, so a
non-cooperating iterator cannot hold the run. It always calls `Query.close()`. The coordinator
slot is released when the work settles. An orphaned run (no local holder) is finished directly. The
request signal is never used, so a browser disconnect does not cancel. The 90 s watchdog aborts
with reason `timeout`, which ends as `failed`.

## Alternatives considered

- Appending the completed message after deltas: the duplicate-text bug this ADR exists to prevent.
- Outbox rows per delta: durable but hundreds of PostgreSQL writes per answer for transient data.
- A per-run SSE endpoint: a second authenticated channel; the existing replayable channel suffices.
- `Query.interrupt()`: it requires streaming input; abort + `close()` are documented for this mode.
- Persisting partial text on cancel: it can end mid-sentence without validated sources. A fixed
  message is stored instead.

## Consequences

Still single-process (milestone 27). Draft text missed during a gap is not re-sent; the
authoritative block or message repairs it. Orphan finishers jump the sequence to 90,000, which
clients treat as a gap. Without Redis, runs work but progress is visible only through polling.
SDK fixtures were authored from type definitions, not captured live. Live streaming behavior
needs verification with credentials.

## Consequences observed (2026-10-02, milestone 20)

`persistSession: false` was changed to the documented default `true` so follow-ups can `resume`; see [0013](0013-resumable-sessions-structured-analysis.md).
