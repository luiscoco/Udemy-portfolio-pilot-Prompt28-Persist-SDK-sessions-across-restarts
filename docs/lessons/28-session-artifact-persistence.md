# 28 — Persist SDK sessions across restarts

A durable job/session ID cannot resume a stateless worker by itself. This lesson distinguishes the
visible application transcript, SDK runtime transcripts and approved application mutations. See
[ADR 0021](../decisions/0021-private-session-checkpoints.md) for the exact artifact inventory,
verified SDK 0.3.276 API and crash boundary.

## Implementation

1. Claim and heartbeat PostgreSQL run/conversation leases before reading artifacts.
2. Make a private, dedicated run workspace. Validate the owner-scoped immutable snapshot and hash.
3. Populate an attempt-local mirror and pass `sessionStore` plus explicit `resume` to `query`.
   The installed SDK creates/cleans a temporary hydrated config directory and materializes the main
   and subagent transcripts itself. Recreate managed skills from application code; disable memory.
4. Mirror the new runtime batches, preserving opaque metadata and deduplicating UUIDs per transcript.
5. After full answer validation, flush/upload an immutable version. Atomically publish its reference
   with the completed application answer under the run fence and session generation check.
6. Clean the workspace. Sweep checkpoints after 30 days and marked abandoned cwd directories after
   24 hours. No raw runtime file is available through the API or a public URL.

## Credential-free checks

```powershell
npm run build
node node_modules/vitest/vitest.mjs run packages/agent/test/session-artifacts.test.ts packages/agent/test/sdk-checkpoint-restart.test.ts apps/worker/test/agent-artifacts.test.ts
```

The SDK restart test runs the **actual pinned CLI** against a deterministic loopback HTTP model
fixture. It completes a turn, deletes the original workspace, restores the saved opaque transcript
through `sessionStore + resume` in a new workspace and checks that the previous assistant context
arrives in the next model request. This is SDK/protocol verification, not a live model evaluation.
Blob contract tests use an injected HTTP fake and need no Azure resources or credentials.

For process/lease acceptance use a dedicated PostgreSQL database; never point these tests at a
shared development or production database. This host has `portfolio-pilot-m06-verify` on port 5546.
Create the database only if it does not already exist:

```powershell
docker exec portfolio-pilot-m06-verify createdb -U portfolio_local portfolio_m28_verify
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m28_verify'
npm run migrate:deploy --workspace=@portfolio-pilot/db
$env:SESSION_ARTIFACT_TEST_DATABASE_URL=$env:DATABASE_URL
node node_modules/vitest/vitest.mjs run apps/worker/test/session-artifacts.integration.test.ts
```

Six PostgreSQL acceptance tests launch real worker processes with mock agents. They verify article
recall after first worker exit and an empty replacement workspace, missing/corrupt reseeding, two
workers racing to restore, stale uploaded snapshot rejection, recovery from last valid checkpoint,
generation CAS rollback and cancellation suppressing publication. Workspaces clean to empty after
each normal run. There are no Azure dependencies in these tests.

## Browser demonstration

Apply the migration to the local development database, then run `npm run dev` with demo sign-in and
mock data as in lesson 27. Start the outbox worker and an agent worker in separate terminals.
In the agent worker terminal set:

```powershell
$env:DATA_MODE='mock'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:WORKER_ROLE='agent'
$env:AGENT_MODE='mock'
$env:SESSION_ARTIFACT_DIR=Join-Path (Get-Location) '.local/session-artifacts'
$env:AGENT_WORKSPACE_DIR=Join-Path $env:TEMP 'portfolio-pilot-turns-first'
npm run start --workspace=@portfolio-pilot/worker
```

Sign in as Alice at `http://127.0.0.1:5173/assistant`, select Growth, ask “Which recent news affects
my largest holding?”, and wait for completion. Stop the agent worker with Ctrl+C. Keep PostgreSQL,
the persistent artifact directory and outbox worker. Change `AGENT_WORKSPACE_DIR` to a new absolute
path such as `$env:TEMP/portfolio-pilot-turns-restarted` and restart the worker. In the **same
conversation**, ask “Tell me more about that article”. The completed answer should report resumed
continuity and mock text “remembered by this session”, with the earlier article re-read through
authorized tools. This distinguishes restored mock state from summary fallback. After completion,
the transient root contains no turn directories.

## Separately gated live verification

Live Claude was **not run** here: application `ANTHROPIC_API_KEY` and `AGENT_MODEL_ID` were absent.
Supply them server-side, then deliberately opt into two small paid calls:

```powershell
$env:RUN_LIVE_SDK_RESTART='true'
node node_modules/vitest/vitest.mjs run packages/agent/test/live-session-artifacts.test.ts -t 'LIVE Claude'
```

This uses one-turn queries capped at estimated USD 0.05 each and deletes the first workspace before
asking for a remembered private code. Provider/SDK cost limits remain estimates, not billing caps.

Live Blob was **not run** here: no existing private container or workload identity was supplied.
Use an existing container with anonymous access disabled, the worker's container-scoped Entra role,
`SESSION_BLOB_CONTAINER_URL`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and
`AZURE_FEDERATED_TOKEN_FILE` (the projected federation assertion file). Then:

```powershell
$env:RUN_LIVE_BLOB_ARTIFACTS='true'
node node_modules/vitest/vitest.mjs run packages/agent/test/live-session-artifacts.test.ts -t 'LIVE Azure Blob'
```

This uploads/reads/deletes only its unique verification conversation scope. It creates no resources.
Deploying workers with `SESSION_ARTIFACT_BACKEND=azure` uses the same adapter and refreshing token
provider. Configure the 30-day lifecycle backstop, private network and least-privilege role before
deployment. No SAS or public download URL is produced.

## Honest limits

An abrupt mid-turn death fails that attempt and loses its incomplete SDK history. The next user
turn resumes the last completed checkpoint; approved application mutations remain saved. A death
after upload but before DB commit creates an orphan snapshot. Missing/corrupt/expired checkpoints
reseed from the authorized application summary and are labeled accordingly. Store outages fail the
run. Legacy local sessions reseed once rather than claiming cross-host continuity. Local Windows
storage requires operator-enforced private ACLs; POSIX uses 0700/0600. The shared worker identity is
a trust boundary, not an OS sandbox. A future product deletion endpoint must call scoped artifact
deletion; current expiry/sweep bounds retained versions. Azure soft-delete/version retention must
also be bounded for physical deletion. No browser UI change was needed; browser testing was not
repeated for this backend slice.

## Student README follow-up — 2026-10-03

Created the missing [root README](../../README.md) with beginner-friendly purpose, definitions,
implementation sequence, changed files, recorded results, setup/test/demo commands and limitations.
It distinguishes actual mock-worker and SDK HTTP-fixture acceptance from the unexecuted live checks
and browser walkthrough. The interactive recipe also starts ingestion to provide recent mock news.
Static PowerShell checks passed for five required sections, 36 balanced fence markers, 12 unique
local link targets and npm script references. This documentation-only follow-up changed README,
project state and this lesson note; application checks were not rerun.

A subsequent review retained that content and added a reading guide, SDK/CLI/UUID definitions,
a data-responsibility table and links to the five new test files. It corrected the historical
migration command to the direct Prisma invocation actually performed. Static checks passed for
five required sections, 38 balanced fence markers, 17 unique local file targets, five heading
anchors and npm script references. No application code or historical test results changed.
