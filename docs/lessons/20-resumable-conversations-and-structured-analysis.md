# 20 — Resumable conversations and structured analysis

## What the learner builds

Follow-up questions now continue the **same SDK session**, and every answer says honestly whether it
did. **Analyze news** returns a typed `news-analysis-v1` document. The server validates it against
the articles the run actually read, so a model cannot cite a source that does not exist. Design:
[ADR 0013](../decisions/0013-resumable-sessions-structured-analysis.md).

## Two kinds of conversation state

| | Application chat history | SDK session |
| --- | --- | --- |
| Where | PostgreSQL `ChatMessage` | `$CLAUDE_CONFIG_DIR/projects/<encoded cwd>/<id>.jsonl` on **one** host |
| Owner | the application (owner-scoped queries) | the Claude Code subprocess |
| Contains | what the user saw: questions, answers, validated sources, analyses | the model's full context: prompts, tool calls, tool results |
| Survives restart / other pod | yes | only on the same host with the file present |
| Linked by | `ConversationSession` row: `sdkSessionId`, `hostKey`, `modelKey`, `instructionVersion`, `generation` | |

Saving `sdkSessionId` is **not** the same as being able to resume. The ID points at a file that may
be gone (restart, cleanup), on another machine, or written under another model or system prompt.

## How a turn picks its session

```
binding? ──no──▶ earlier turns? ──no──▶ NEW session
   │                    └─yes─▶ RESEEDED (not_recorded)
   └─yes─▶ same model + instruction? ──no──▶ RESEEDED (configuration_changed)
           same hostKey? ──────────────no──▶ RESEEDED (not_local)
           transcript file present? ───no──▶ RESEEDED (session_missing)
           └─yes─▶ query({ options: { resume: id } })
                     └─ fails before any output ─▶ one retry, RESEEDED (resume_failed)
```

- **Resumed** turns send only the new request; the session already has the earlier turns.
- **Reseeded** turns start a new session with a `seed`. The server builds it only from the owner's
  completed messages and validated sources, and it is labelled "not a transcript".
- Each assistant message stores `continuity`. The UI shows **Continued in the same assistant
  session**, **New assistant session**, or a highlighted note saying a new session saw only a summary
  and why.
- `continue: true` is never used: it resumes the directory's most recent session, which could belong
  to another user.

**Serialization:** a second question while one is answering gets **409**. This is a deliberate
rejection, not a queue. The binding moves only by compare-and-set on `generation`.

## Structured analysis without trusting the model

1. The live adapter passes the documented
   `outputFormat: { type: 'json_schema', schema: z.toJSONSchema(newsAnalysisSchema, { target: 'draft-7' }) }`.
   Prose streamed meanwhile is hidden.
2. `result.structured_output` is **untrusted**. `validateNewsAnalysis` parses it with Zod, then checks:
   - every article ID was read with `getNewsArticle` **in this run**;
   - evidence URLs and publication times equal the tool's;
   - affected securities are linked to the cited article with the tool's relation;
   - every claim cites a listed article that has an evidence link.
3. On failure there is **one** retry in the same session. The correction lists paths and rule codes
   only.
4. The run then fails with a typed code: `analysis_invalid_structure`,
   `analysis_missing_references`, `analysis_unknown_source`, `analysis_no_output` or
   `analysis_retries_exhausted`. Nothing unvalidated is persisted or shown.

Fixtures: `packages/agent/test/fixtures/analysis/` (`valid`, `invalid-structure`,
`missing-references`, `unknown-source`). The session and structured SDK fixtures in
`packages/agent/test/fixtures/sdk/` are `resumed-follow-up`, `session-resume-failed` (assumed
shape), `structured-output` and `structured-retries-exhausted`.

## Demonstrate it

```powershell
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d postgres -c "CREATE DATABASE portfolio_m20_verify;"
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m20_verify'
npm run migrate:deploy --workspace=@portfolio-pilot/db
$env:SESSION_TEST_DATABASE_URL=$env:DATABASE_URL; $env:DATA_MODE='mock'
npm exec --workspace=@portfolio-pilot/api -- vitest run lib/conversation-sessions.integration.test.ts lib/conversation-sessions.test.ts
npm run test --workspace=@portfolio-pilot/agent    # fixtures, live-adapter options, session files, mock follow-ups
```

Browser (dev servers as in lesson 19, on `portfolio_m19_verify` migrated to head, Redis DB 13):

```powershell
$env:CHAT_E2E_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m19_verify'
npm run test:browser --workspace=@portfolio-pilot/web -- chat.spec.ts --workers=1
```

UI steps on `/assistant` as Alice:

1. Ask *"Which recent news affects my largest holding?"*. The answer shows *New assistant session*.
2. Click **Tell me more about the first cited article**, then **Send**. The answer shows *Continued in
   the same assistant session* and re-reads the article.
3. Restart the API and ask again. The answer shows the reseeded note: *no longer stored on this
   server* (mock sessions are process-local, like SDK files on one host).
4. Type *"Analyze recent news for this portfolio"* and press **Analyze news**. Facts, events,
   affected securities, interpretation and uncertainties appear, each linked to validated sources.
5. Click **Start a new conversation with the same scope**. It starts fresh, with no session.

## Deferred

- Cross-pod or restart persistence of SDK transcripts (`SessionArtifactStore`, Blob, lease-guarded
  restore, retention) is **milestone 28**.
- Durable queued turns are milestone 27.
- Session files in `AGENT_WORKSPACE_DIR` are not cleaned up yet.
