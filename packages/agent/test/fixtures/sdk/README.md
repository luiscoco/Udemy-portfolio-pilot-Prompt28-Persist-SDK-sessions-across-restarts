# Recorded SDK stream fixtures

Each `*.json` file is an ordered sequence of `SDKMessage` values, as yielded by `query()` from
`@anthropic-ai/claude-agent-sdk` 0.3.276 with `includePartialMessages: true`. They are replayed
through `SdkStreamMapper` in `../../streaming.test.ts`.

Provenance: these fixtures were authored from the installed `sdk.d.ts` and the Messages API
streaming event types (`@anthropic-ai/sdk` 0.130.0, `BetaRawMessageStreamEvent`). They were
**not** captured from a live Claude call, because no `ANTHROPIC_API_KEY` was available while
milestone 19 was built. Replace or extend them with sanitized captures when a live run is possible.

| File | Scenario |
| --- | --- |
| `partial-plus-final.json` | Text deltas, then the completed block, then a `result` repeating the same text |
| `tool-then-answer.json` | Thinking (hidden), preamble text, a tool call with streamed arguments, progress heartbeats, tool result, final text turn |
| `tool-only-step.json` | A turn that is only a (failed) tool call, then a final text turn |
| `error-result.json` | Partial text, an assistant `error`, and an `error_during_execution` result with diagnostics that must not leak |
| `duplicate-delivery.json` | A repeated completed frame (same `uuid`), a subagent frame, a late delta, and authoritative text that differs from the draft |
| `no-partials.json` | No `stream_event` frames at all: only the completed message and result |

The fixtures contain only fictional data and placeholder secrets used to prove they never surface.

## Milestone 20 additions (sessions and structured output)

Also authored from the installed 0.3.276 `sdk.d.ts` and the official Sessions / Structured outputs
pages (checked 2026-10-02), not captured live. The session ID appears on `system/init` and on every
`result`, as documented.

| File | Scenario |
| --- | --- |
| `resumed-follow-up.json` | A follow-up turn in an existing session (same `session_id` on init and result) |
| `session-resume-failed.json` | **Assumed shape**: an `error_during_execution` result with no init, no text and no tool call, as a failed resume of a missing session might produce. The exact CLI text is not documented, so the adapter keys only on "failed before any output", never on the message. |
| `structured-output.json` | `outputFormat` run: prose that must stay hidden, then `result.structured_output` (the valid analysis fixture) |
| `structured-retries-exhausted.json` | The documented `error_max_structured_output_retries` subtype with diagnostics that must not leak |
