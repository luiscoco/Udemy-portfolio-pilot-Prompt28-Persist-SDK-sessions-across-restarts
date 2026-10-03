# 0013. Resumable conversation sessions and validated structured analysis

- Status: Accepted
- Date: 2026-10-02
- Milestone: 20
- Amends: [0011](0011-grounded-chat-local-coordination.md) (history sent as data to a fresh session) and [0012](0012-streamed-agent-runs.md) (`persistSession: false`)

## Context

Follow-up questions should continue the conversation the model already had, not only re-read a
clipped history. The application also needs news analysis as typed data whose sources can be
trusted. Verified on 2026-10-02 in the installed `@anthropic-ai/claude-agent-sdk` 0.3.276
`sdk.d.ts` and the official pages *Work with sessions* and *Get structured output from agents*:

- `Options.resume` resumes a session by ID; `continue` resumes the **most recent** session in the
  directory; `forkSession` branches; `persistSession: false` means sessions "cannot be resumed".
- The session ID is on the `system/init` message and on every `result` (`session_id`).
- Transcripts are files under `$CLAUDE_CONFIG_DIR/projects/<encoded cwd>/<id>.jsonl`. "Session files
  are local to the machine that created them"; resuming elsewhere needs a `sessionStore` (alpha) or
  moving the file, or "don't rely on session resume" and seed a fresh session from application state.
- `getSessionInfo()` returns `undefined` for a missing file, but reads the **calling process's**
  `CLAUDE_CONFIG_DIR`, not the subprocess's isolated one.
- `outputFormat: { type: 'json_schema', schema }` (draft-07; `z.toJSONSchema(..., { target: 'draft-7' })`)
  yields `result.structured_output`; the SDK re-prompts on schema mismatch and ends with
  `error_max_structured_output_retries`. A success without `structured_output` must also be treated as
  a failure. A single-shot `query()` throws after yielding an error result.
- What the CLI emits when `resume` names a missing session is **not documented**.

## Decision

**Two kinds of state, kept apart.** `ChatMessage` in PostgreSQL remains the complete, owner-scoped
application history. A new `ConversationSession` row holds only a pointer to the conversation's
current SDK session: `sdkSessionId`, `agentMode`, `hostKey` (hash of host name + realpath of the
session workspace, or a per-process key for the mock), `instructionVersion`, `modelKey`, a
compare-and-set `generation` and `lastRunId`. Saving the ID is not treated as making the session
portable.

**Resume only what is verifiably resumable.** Per turn, `resolveSession` decides:

| Condition | Disposition | Reason |
| --- | --- | --- |
| No binding, no earlier completed turns | `new` | — |
| No binding, earlier turns exist | `reseeded` | `not_recorded` |
| Different model key or instruction version | `reseeded` | `configuration_changed` |
| Different host key | `reseeded` | `not_local` |
| Transcript file absent/empty | `reseeded` | `session_missing` |
| Otherwise | `resumed` | — |

The live adapter sets `persistSession: true` with `CLAUDE_CONFIG_DIR` and `cwd` = the isolated
workspace, passes `resume` (never `continue`, which could pick another user's latest session) and
captures `session_id` from init/result. The transcript check scans
`<workspace>/projects/*/<uuid>.jsonl` directly (documented layout; IDs must be UUIDs, so no path
traversal) because `getSessionInfo()` cannot see the subprocess's config directory. If a resume
attempt fails **before any visible text or tool call**, the adapter throws `SessionResumeError`
(keyed on "no output", never on undocumented CLI text). The run then retries once in a new session
with reason `resume_failed`. A failure after output is an ordinary failure.

**Reseeding is explicit.** A reseeded turn sends `continuity: "reseeded"` and a `seed` built by the
server from the owner's completed messages: the last eight turns clipped to 1,000 characters, an
omitted-turn count, up to ten previously validated cited sources, and a note that it is not a
transcript. A resumed turn does not resend history. Every assistant message stores
`continuity { disposition, reason }`. The UI shows "Continued in the same assistant session",
"New assistant session", or a highlighted note that a new session saw only a summary and why.
Instruction `portfolio-research-v2` adds continuity and analysis rules to v1. One prompt serves both
run kinds because a resumed session keeps its original system prompt.

**Serialization.** Overlapping turns in a conversation are **rejected (409)**, not queued: the
coordinator holds one slot per conversation and the database allows one running run. A queue would
need durable ordering and expiry, which belongs to the worker (milestone 27). The binding is updated
by compare-and-set on `generation`, so a stale writer cannot overwrite a newer session.

**Structured analysis.** `POST …/runs` accepts `kind: 'answer' | 'news_analysis'`.
`newsAnalysisSchema` (`news-analysis-v1`, packages/contracts) has these fields:

- article references
- event categories (11)
- affected securities with relation `held`, `watchlisted` or `mentioned`
- factual summary
- interpretations, with `low` or `medium` confidence; `high` is not representable
- at least one uncertainty
- as-of time
- evidence links

It is strict and bounded. It is converted to draft-07 for `outputFormat`. Prose streamed during an
analysis run is suppressed. `validateNewsAnalysis` never casts or parses strings. In order, it
checks:

1. Zod structure, plus an as-of time that is not in the future and no earlier than any cited
   article.
2. Unknown sources: every article ID anywhere must have been read with `getNewsArticle` **in this
   run**. Evidence URLs and publication times must match the tool's values. Each affected security
   must be linked to its cited article, with the tool's symbol and relation.
3. Missing references: facts, events, interpretations and securities cite at least one article; every
   cited article is listed and has an evidence link.

Titles are taken from the tools. On failure the server makes **one** more attempt, resuming the
first attempt's session. The correction prompt names only paths and rule codes, never model text or
IDs. After two attempts the run fails with a typed code: `analysis_invalid_structure`,
`analysis_missing_references` or `analysis_unknown_source`. The SDK-side codes are
`analysis_no_output` and `analysis_retries_exhausted`. A failed run persists a fixed message and no
analysis. A valid analysis is stored as JSON; its sources are exactly its validated articles, and its
Markdown is rendered deterministically on the server.

**Mock parity.** The mock keeps bounded, process-local sessions that remember only cited article
IDs, so a restart behaves like a missing live session. It honours the same `SessionResumeError`
contract, resolves "the first/second cited article" from the session or the seed, and builds a
deterministic analysis only from its own tool reads.

## Alternatives considered

- **`continue: true`:** it resumes the directory's latest session, which may belong to another
  conversation or user.
- **Trusting a stored ID:** it fails silently after a restart or on another pod, and would claim a
  continuity that did not happen.
- **`sessionStore` now:** it is alpha, its key depends on `cwd`, and it is a cross-host concern
  (milestone 28).
- **Queueing overlapping turns:** this needs durable ordering (milestone 27).
- **Trusting SDK schema validation alone:** it cannot know which articles were actually read.
- **Allowing previously cited sources without re-reading them:** that would require a durable
  per-article security registry; re-reading keeps provenance per run.

## Consequences

Follow-ups resume on the same API process and workspace. After a restart (mock) or on another host
(live), the answer is honestly reseeded. Transcripts containing private tool results now persist
under `AGENT_WORKSPACE_DIR`. That directory must stay server-only, and it has **no retention or
cleanup yet**. Encrypted artifact storage, retention and restore under a conversation lease, for
**cross-pod and restart persistence, are deferred to milestone 28**. A run's analysis may cite only
articles re-read in that run. The live resume-failure fixture is an assumed shape. Live structured
output, resume latency and session file growth are unverified without credentials. Detect wrong
decisions through rising `reseeded`/`resume_failed` rates or `analysis_*` failure codes in `AgentRun`.

## References

Checked 2026-10-02:

- [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Get structured output from agents](https://code.claude.com/docs/en/agent-sdk/structured-outputs)
- Installed `@anthropic-ai/claude-agent-sdk` 0.3.276 `sdk.d.ts`: `Options.resume`, `persistSession`,
  `outputFormat`, `SDKResultSuccess.structured_output`, `session_id`, `getSessionInfo`
- `zod` 4.6.5 `z.toJSONSchema` with `target: 'draft-7'` (verified output locally)

## Persistence follow-up — 2026-10-03

Milestone 28 replaces the host-local storage constraint for durable worker turns with the private
completed-turn checkpoint strategy in [ADR 0021](0021-private-session-checkpoints.md). Explicit
resume, configuration compatibility and truthful summary reseeding remain. The UUID still does not
contain runtime state: the immutable snapshot and its fenced PostgreSQL pointer supply it.
