# 19 — Stream agent answers without duplicate text

## What the learner builds

The Assistant now streams. A question creates a **run** that returns immediately (202). Progress
arrives over the existing authenticated SSE channel: tool status, a growing draft, then the
persisted answer, which replaces the draft. The answer is shown **once**, never the deltas plus
the full message again. **Cancel answer** stops the run explicitly. Closing or reloading the tab does
not. Design: [ADR 0012](../decisions/0012-streamed-agent-runs.md).

```
Browser ──POST /api/conversations/:id/runs──▶ admit (409 if busy) ─▶ capture pre-run cursor
   ▲              202 {run, userMessage, replayCursor}   ─▶ INSERT user message + AgentRun(running)
   │                                                     ─▶ launch in background (no request signal)
   │  SSE /api/events (owner stream)                           │
   │◀── agent.run.started / tool.status / text.delta ◀── RunEventPublisher ◀── SdkStreamMapper ◀── query({ includePartialMessages: true })
   │◀── agent.block.completed  (authoritative block, once)                         (mock: same events)
   │◀── agent.message.completed (persisted ChatMessage) + agent.run.completed ◀── finishRun (exactly once)
   └── POST /api/runs/:id/cancel ──▶ requestCancel (DB) ──▶ coordinator.cancel ──▶ abortController.abort() + Query.close()
```

## The duplicate-text bug, and the rule that prevents it

With `includePartialMessages: true` the SDK yields `stream_event` frames (`content_block_delta`
with `text_delta`). When a block finishes, a complete `assistant` message delivers the same text.
The final `result.result` repeats it once more. Appending each of them shows the answer two or
three times.

Rule implemented by `SdkStreamMapper` (packages/agent/src/streaming.ts):

1. Deltas build a **draft** for a block (`text.delta`).
2. The completed assistant block is **authoritative**. It is emitted once as `block.completed`,
   and consumers **replace** the draft with it. Drafts are matched by API `message.id` in order.
3. `result.result` is used only if no text block was ever seen.
4. Duplicate SDK frames (same `uuid`), subagent frames, thinking, tool-input JSON and tool
   results are dropped. Tool names become one of six public names or `other`.

## Identity, ordering and duplicates

| Field | Meaning |
| --- | --- |
| `runId` | Application run (`AgentRun.id`) |
| `messageId` | Pre-allocated assistant `ChatMessage.id`; the persisted message reuses it |
| `blockId` | `<messageId>.bN`; `toolCallId` is `<messageId>.tN` |
| `sequence` | Per message, contiguous from 0, assigned at publication |
| `offset` | Character position of a delta inside its block |
| event `id` | UUIDv5(run, sequence): redelivery keeps the same ID |

The browser reducer (`apps/web/src/lib/agent-runs.ts`) applies four rules. A lower sequence is a
duplicate and is ignored. A higher one is a gap, so open drafts are marked incomplete. A delta
applies only at `offset === draft.length`. Completed blocks and messages replace the draft.

## Race-free handshake

The server captures the stream cursor **before** inserting the run, so every run event is after
`replayCursor`. The browser's live connection already predates the POST. If a snapshot recovery
replaced its cursor in between, `StreamManager.ensureReplay` reconnects from `replayCursor`. The
integration test proves it with no artificial delay: it subscribes only **after** the run has
finished and still receives every event, in order.

## Durability, recovery, cancellation

- `AgentRun` + partial unique index: one running run per conversation, even if the coordinator is bypassed.
- `finishRun` is the only terminal transition. It is a conditional update plus the assistant
  message insert in one transaction, so concurrent finishers (worker, cancel, stale recovery)
  cannot both win.
- Reload: `GET /api/conversations/:id/runs/active`, the messages list and SSE recover the state.
  While a run is active the page also polls it (5 s live, 2 s otherwise) in case events were lost.
- `POST /api/runs/:id/cancel` is owner-scoped, origin-checked and idempotent. The live adapter
  aborts the SDK `abortController`, races reads against abort and always calls `Query.close()`.
  `interrupt()` is not used because it requires streaming input mode.
- Runs older than 120 s that no process holds are finished as *interrupted*. Cancelling such an
  orphan finishes it directly.

## Demonstrate it

```powershell
npm ci --ignore-scripts --offline --cache .npm-cache
npm run build
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d postgres -c "CREATE DATABASE portfolio_m19_verify;"
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m19_verify'
npm run migrate:deploy --workspace=@portfolio-pilot/db
```

Automated (real PostgreSQL + Redis, real route handlers and SSE endpoint):

```powershell
$env:CHAT_TEST_DATABASE_URL=$env:DATABASE_URL; $env:CHAT_TEST_REDIS_URL='redis://127.0.0.1:6379/11'; $env:DATA_MODE='mock'
npm exec --workspace=@portfolio-pilot/api -- vitest run lib/chat.integration.test.ts lib/agent-run-events.test.ts lib/chat-coordinator.test.ts
npm run test --workspace=@portfolio-pilot/agent   # recorded SDK fixtures + cancellation
npm run test --workspace=@portfolio-pilot/web     # browser reducer: duplicates, gaps, replay
```

Browser: start the stack with the streaming pace visible, then run the Chrome tests.

```powershell
$env:REDIS_URL='redis://127.0.0.1:6379/13'; $env:DATA_MODE='mock'; $env:AGENT_MODE='mock'; $env:AGENT_MOCK_STREAM_DELAY_MS='80'
$env:DEMO_AUTH_ENABLED='true'; $env:AUTH_BASE_URL='http://127.0.0.1:5173'; $env:AUTH_SECRET='local-only-verification-secret-1234567890'
npm run dev
# second terminal
$env:CHAT_E2E_DATABASE_URL=$env:DATABASE_URL
npm run test:browser --workspace=@portfolio-pilot/web -- chat.spec.ts --workers=1
```

Manual steps: open `http://127.0.0.1:5173/assistant` and sign in as Alice. Create a conversation
scoped to a portfolio and ask *"Which recent news affects my largest holding?"*. Tool progress
appears ("Searching stored news · done"), the dashed draft grows, then it becomes
**Assistant · MOCK** with validated links, and the text appears once. Ask again, then click
**Cancel answer**: the answer becomes **Assistant · Cancelled**. Ask again and reload the page
mid-answer: the run keeps going, and after reselecting the conversation the completed answer is shown.

## Recorded fixtures

`packages/agent/test/fixtures/sdk/*.json` cover these scenarios: partial plus final,
tool-then-answer, a tool-only step, an error result, duplicate delivery, and no partial frames.
They were written from the installed type definitions because no API key was available. They were
not captured live; replace them with sanitized live captures when possible.

## Limits carried forward

- Single API process (milestone 27). In-flight runs end as *interrupted* after a restart.
- No live Claude verification yet: real partial-message cadence, block splitting and abort
  latency are unverified.
- Missed draft text is not re-sent; the authoritative block or message repairs the view.
- Cancelling keeps no partial text. Approvals and richer cancellation semantics are milestone 25.
