# PortfolioPilot — Milestone 28: Persist SDK Sessions Across Restarts

This learning activity adds durable conversation checkpoints to PortfolioPilot, a stock portfolio
manager with portfolio-aware chat and cited news. A **checkpoint** is a saved copy of the assistant's
runtime state after a successfully completed turn. A **turn** is one user request and its answer.

The implementation is complete for local verification. Worker restart tests and an actual SDK/CLI
test passed. Live Claude and live Azure Blob verification have **not** been performed. Nothing has
been deployed to Azure.

### Reading Guide

- [Purpose and learning goals](#1-purpose-what-this-activity-builds-and-why-it-matters)
- [Implementation steps](#2-steps-performed-during-implementation)
- [Observed results](#3-results-achieved)
- [Setup and verification](#4-how-to-run-and-verify)
- [Limitations and unfinished work](#5-limitations-and-unfinished-work)

## 1. Purpose: What This Activity Builds and Why It Matters

Milestone 27 moved assistant execution into a background worker: a separate process that reads
queued jobs from PostgreSQL. Milestone 28 makes completed assistant conversations portable across
worker restarts, including restarts where the new worker has an empty temporary directory.

Saving only a session ID or the chat messages shown in the browser is insufficient. The Claude
Agent SDK also needs its runtime transcripts: records containing message links, summaries and
other internal state. A subagent, or helper agent, can have its own transcript too. These records
must be preserved in the format the SDK understands.

The coding agent was asked to:

- Verify the installed SDK's supported persistence and resume mechanism.
- Implement a `SessionArtifactStore` interface with local persistent and Azure Blob storage.
- Keep files private and separate each user's conversations.
- Restore state only after acquiring the conversation lease.
- Publish completed-turn snapshots atomically and prevent old attempts from replacing new ones.
- Test restart, missing/corrupt files and competing workers; document the mid-turn crash limit.

You will learn how to separate durable storage from temporary workspaces, check file integrity,
coordinate workers, test an SDK without paid model calls, and describe recovery guarantees honestly.

### Important Terms

| Term | Meaning in this activity |
| --- | --- |
| SDK | Software development kit: the library the application uses to run Claude agents. |
| CLI | Command-line interface: the executable process started by the SDK. |
| UUID | A unique identifier used for sessions, messages and snapshot versions. |
| Artifact | A stored piece of runtime state needed to continue a conversation. |
| Lease | A temporary database claim giving one worker permission to handle a conversation. |
| Fencing | Rejecting writes from a worker whose lease or attempt is no longer current. |
| Immutable version | A snapshot saved under a new key; existing snapshots are not overwritten. |
| Integrity check | Comparing a SHA-256 fingerprint with the saved bytes to detect corruption. |
| Atomic publication | Committing the new checkpoint reference and completed answer together, or neither. |
| Reseeding | Starting a new SDK session using an authorized summary when the old state is unavailable. |
| Mock / fixture | A controlled substitute for a real service, used for repeatable tests. |

## 2. Steps Performed During Implementation

These are the steps actually performed, in order. The commands below describe the implementation
and verification work; the run instructions in section 4 explain how to repeat it.

### Step 1 — Inspect the Existing Worker and Verify SDK Support

The agent read the project contract, state, milestone scope, worker execution code, session binding
code and official SDK documentation. Dependencies were restored using the existing local npm cache:

```powershell
npm ci --ignore-scripts --offline --cache .npm-cache
```

The installed SDK remains **0.3.276**. Its types and implementation were checked for `sessionStore`,
`sessionStoreFlush`, `append`, `load`, `listSubkeys`, `mirror_error` and `importSessionToStore`.
No dependencies were upgraded. There is no standalone archive export/import API in this version.
`importSessionToStore` copies an existing local session into a store; this implementation uses an
attempt-local transcript mirror instead.

The chosen resume mechanism is `query` with `sessionStore` and an explicit `resume` ID. The SDK
loads the saved main and subagent entries into its own unique temporary configuration directory
before starting the CLI. The worker also creates a dedicated run working directory after claiming
the database lease. Credentials and managed skills are supplied separately from runtime snapshots.

Sources reviewed: [SDK session storage](https://code.claude.com/docs/en/agent-sdk/session-storage),
[sessions](https://code.claude.com/docs/en/agent-sdk/sessions),
[hosting](https://code.claude.com/docs/en/agent-sdk/hosting), and the installed SDK definitions/source.
The exact artifact inventory is recorded in [ADR 0021](docs/decisions/0021-private-session-checkpoints.md).

The three kinds of conversation data serve different purposes:

| Data | Where it belongs | What it provides |
| --- | --- | --- |
| Application chat messages | PostgreSQL | Visible history and an authorized summary for fallback. |
| SDK main/subagent transcripts and metadata | Private artifact snapshots | Runtime state required by the supported resume mechanism. |
| Completed checkpoint reference and generation | PostgreSQL | Which immutable snapshot the next worker may use. |

The SDK recreates its JSONL files, where each line is a JSON record, from the saved entries.
Subagent metadata sidecars are also reconstructed. Credentials, personal configuration and mutable
memory files are not included. Managed application skills are recreated from versioned code.

### Step 2 — Implement Private, Versioned Storage

Created:

- [session-artifacts.ts](packages/agent/src/session-artifacts.ts): the interface, snapshot format,
  local implementation, integrity checks and attempt-local SDK mirror.
- [azure-session-artifacts.ts](packages/agent/src/azure-session-artifacts.ts): the Azure Blob REST
  implementation and refreshing workload-identity token provider.

Snapshots preserve the opaque main/subagent entries and their order. **Opaque** means the app keeps
the SDK records intact rather than trying to rebuild their internal meaning from visible messages.
Repeated records with the same UUID are deduplicated within each transcript.

Keys contain hashed owner/conversation scopes and unique timestamp/UUID versions. Snapshots include
format and SDK versions, model/instruction metadata, timestamps and a checksum reference. The size
limit is 16 MiB. Local writes flush a temporary file and publish it exclusively using a hard link.
Azure writes require an existing private container, authenticated HTTPS and conditional creation.
There are no public download routes or generated shared-access download URLs.

### Step 3 — Connect Storage to Leased Worker Execution

Created [agent-artifacts.ts](apps/worker/src/agent-artifacts.ts) and modified worker
`agent.ts` / `agent-execution.ts`, agent `index.ts` / `streaming.ts`, server configuration and
[the worker environment example](apps/worker/.env.example).

The worker restores snapshots after acquiring its run/conversation lease. It creates a fresh
workspace, restores mock memory or an SDK transcript mirror, runs the turn and validates the answer.
SDK mirror failures prevent checkpoint publication. Normal exits clean the workspace. Later run
setup also removes marked workspaces abandoned for more than 24 hours.

The storage policy expires snapshots after 30 days. Workers sweep old snapshots hourly, including
unreferenced versions left by failed publication. The interface also supports deleting every version
for one authenticated owner/conversation scope.

### Step 4 — Publish Checkpoints With the Completed Answer

Modified [the Prisma schema](packages/db/prisma/schema.prisma) and
[chat-service.ts](packages/db/src/chat-service.ts). Added two migrations:

- `20261015100000_session_artifacts`: checkpoint key, checksum, expiration and pointer constraint.
- `20261015101000_session_artifact_constraint`: explicitly rejects a populated pointer with a null
  checksum. SQL checks can otherwise accept an unknown/null result; this correction preserved the
  already-applied first migration.

The upload creates a new immutable object. PostgreSQL then publishes its reference in the same
transaction as the completed answer and terminal events. The transaction checks the current lease
and session generation, or version counter. Failed, cancelled and stale attempts keep the previous
checkpoint. An upload without a successful transaction is an **orphan**: an unreferenced object that
retention cleanup will remove.

### Step 5 — Test Restart and Failure Cases

Added storage, real SDK/CLI, live-gated, workspace-cleanup and PostgreSQL process acceptance tests.
An isolated `portfolio_m28_verify` database was created on the existing local test PostgreSQL server.
Prisma generated the client and applied all 18 project migrations.

The migration command was invoked directly from `packages/db`:

```powershell
node ../../node_modules/prisma/build/index.js migrate deploy
```

From the repository root, the application checks were run through the installed npm CLI:

```powershell
npm run typecheck
npm run build
npm run test
node scripts/check-browser-boundary.mjs
```

The new test files explain which guarantee each check covers:

| Test file | What it checks |
| --- | --- |
| [session-artifacts.test.ts](packages/agent/test/session-artifacts.test.ts) | Local persistence, integrity, ownership, retention and mocked Azure requests. |
| [sdk-checkpoint-restart.test.ts](packages/agent/test/sdk-checkpoint-restart.test.ts) | Actual SDK/CLI restoration against a local HTTP model fixture. |
| [agent-artifacts.test.ts](apps/worker/test/agent-artifacts.test.ts) | Cleanup preserves active and unrelated directories. |
| [session-artifacts.integration.test.ts](apps/worker/test/session-artifacts.integration.test.ts) | Real PostgreSQL and worker-process restart, races, stale attempts and cancellation. |
| [live-session-artifacts.test.ts](packages/agent/test/live-session-artifacts.test.ts) | Separately gated live Claude and Azure Blob checks; not executed during implementation. |

The focused test commands are listed in section 4. Initial failures were corrected: the integration
test imported a seed helper that was not exported, and a worker-only production storage requirement
incorrectly affected API startup. Docker/Prisma cache access and the local npm shim also needed
environment workarounds. Final checks passed; details remain in [project state](docs/project-state.md).

### Step 6 — Record the Decisions and Learning Notes

Added [lesson 28](docs/lessons/28-session-artifact-persistence.md) and
[ADR 0021](docs/decisions/0021-private-session-checkpoints.md). Updated project state, the decisions
index, version notes and the persistence follow-up in ADR 0013. Milestone 29 is the next activity.
This README was added afterward as a documentation-only follow-up.

## 3. Results Achieved

### Observed Application Behavior in Automated Acceptance

The tests completed a mock news turn, let its worker process exit, removed its temporary workspace,
then launched another worker with a new empty workspace. The follow-up resumed the same mock
session and re-read the earlier cited article through authorized tools.

The tests asserted resumed continuity and this phrase in the answer:

```text
remembered by this session
```

For missing or corrupt artifacts, they asserted the following continuity result and summary-based
answering instead:

```json
{
  "disposition": "reseeded",
  "reason": "session_missing"
}
```

Competing workers produced one completed turn and one new checkpoint. Stale attempts could not
publish their uploaded versions. Generation mismatches rolled back completion, cancellation
suppressed checkpoint publication, and a later user turn resumed the last valid checkpoint after
an interrupted attempt.

### What the Real SDK Test Proved

The test used the **actual installed SDK and CLI**, with a local HTTP model fixture. It completed a
turn, deleted the original workspace, restored the checkpoint in a new workspace and verified that
the earlier assistant context appeared in the next model request. This proves the tested SDK
restoration path. It is not a live Claude response-quality test.

### Recorded Verification Results

These results are from milestone 28 implementation on 2026-10-03, not a fresh run during this README update.

| Check | Observed result |
| --- | --- |
| Offline dependency restoration | 348 packages installed; 0 reported vulnerabilities |
| Prisma migration deployment | All 18 migrations applied to the isolated test database |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, with existing warnings described below |
| Browser package boundary check | Passed |
| `npm run test` | 294 passed; 118 gated tests skipped |
| Focused storage / SDK / cleanup command | 9 passed; 2 live tests skipped |
| PostgreSQL worker restart acceptance | 6 passed |
| Live Claude / live Azure Blob | Not run |
| Milestone 28 browser test | Not run |

The focused tests overlap the repository suite; their totals are not additional independent tests.
Azure contract tests used a fake HTTP storage backend and ran without Azure credentials.

## 4. How to Run and Verify

Run commands from the repository root. Examples use **PowerShell**. Keep secrets in server-side
environment variables or ignored local environment files.

### Prerequisites and Installation

- Node.js **24.21.0** and npm **11.19.0**, matching the project's pinned toolchain.
- Docker with Linux containers for PostgreSQL/Redis and process acceptance tests.
- The SDK's platform-specific CLI dependency, installed with npm's optional dependencies intact.
- A private persistent directory for artifacts, separate from the temporary workspace root.

No Anthropic or Azure credentials are needed for the mock demo and local fixture tests.

```powershell
node --version
npm --version
npm ci --ignore-scripts
npm run build
```

The online installation above is the normal student setup. The observed implementation used the
offline-cache command from section 2 because the existing cache was available. Do not use
`--omit=optional`: the real SDK test needs the bundled native CLI.

### Run Credential-Free Verification

```powershell
npm run typecheck
npm run test
node scripts/check-browser-boundary.mjs

node node_modules/vitest/vitest.mjs run packages/agent/test/session-artifacts.test.ts packages/agent/test/sdk-checkpoint-restart.test.ts packages/agent/test/live-session-artifacts.test.ts apps/worker/test/agent-artifacts.test.ts
```

With live flags unset, the last command should run nine tests and skip the two explicitly gated
live tests. It needs no Docker database. The full suite skips opt-in integrations when their
required environment variables are absent; a skipped test is not a verified result.

### Run the PostgreSQL Worker Restart Tests

Use a dedicated database named `portfolio_m28_verify` on `127.0.0.1`. These tests create fixtures;
they are not suitable for a shared development or production database.

The implementation used an existing container named `portfolio-pilot-m06-verify` on port 5546.
If that container exists, create the database only if it does not already exist:

```powershell
docker exec portfolio-pilot-m06-verify createdb -U portfolio_local portfolio_m28_verify
```

For a student machine without that container, this alternative setup uses the same pinned
PostgreSQL image. This particular container recipe was **not run during milestone 28 verification**:

```powershell
docker run --name portfolio-pilot-m28-verify -e POSTGRES_USER=portfolio_local -e POSTGRES_PASSWORD=local_only_change_me -e POSTGRES_DB=portfolio_m28_verify -p 127.0.0.1:5546:5432 -d postgres:17.6-alpine
docker exec portfolio-pilot-m28-verify pg_isready -U portfolio_local -d portfolio_m28_verify
```

Wait until PostgreSQL reports it is accepting connections. If port 5546 is occupied, choose another
free local port and update the URL below. Then:

```powershell
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m28_verify'
npm run migrate:deploy --workspace=@portfolio-pilot/db
$env:SESSION_ARTIFACT_TEST_DATABASE_URL=$env:DATABASE_URL
node node_modules/vitest/vitest.mjs run apps/worker/test/session-artifacts.integration.test.ts
```

Expected result: six passing tests, with actual worker subprocesses. Run this suite independently
of other demo-user integration tests or workers using that test database. The suite seeds its own
current-time news and portfolios; no separate seed command is required.

### Start the Interactive Mock Application

This is a manual demonstration recipe. Automated process behavior was verified; the milestone 28
browser demonstration itself was **not** rerun.

Start the normal local infrastructure and prepare the development database:

```powershell
npm run infra:start
npm run infra:status

$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run migrate:deploy --workspace=@portfolio-pilot/db
npm run seed:demo --workspace=@portfolio-pilot/db

if (-not (Test-Path apps/api/.env.local)) {
  Copy-Item apps/api/.env.example apps/api/.env.local
}
```

In `apps/api/.env.local`, use the normal local database URL on port 5432, Redis on port 6379,
`DATA_MODE=mock`, `AGENT_MODE=mock`, `DEMO_AUTH_ENABLED=true` and
`AUTH_BASE_URL=http://localhost:5173`. For a repeatable local login setup, set one stable
`AUTH_SECRET` of at least 32 characters and keep it in that file. Existing local settings are
preserved by the conditional copy.

The seed contains clearly labeled synthetic data dated January 2025. Start the ingestion worker
below to provide recent mock news for the follow-up demonstration. Workers do not automatically
read `.env` files; these commands explicitly load the same API environment file.

**Terminal 1 — React frontend and API:**

```powershell
npm run dev
```

**Terminal 2 — Recent mock news ingestion:**

```powershell
$env:WORKER_ROLE='ingestion'
node --env-file=apps/api/.env.local apps/worker/dist/index.js
```

**Terminal 3 — Event delivery:** The outbox worker forwards committed events to Redis so the
browser can receive streamed progress.

```powershell
$env:WORKER_ROLE='outbox'
node --env-file=apps/api/.env.local apps/worker/dist/index.js
```

**Terminal 4 — Assistant execution and checkpoint storage:**

```powershell
$env:WORKER_ROLE='agent'
$env:SESSION_ARTIFACT_BACKEND='local'
$env:SESSION_ARTIFACT_DIR=Join-Path (Get-Location) '.local/session-artifacts'
$env:AGENT_WORKSPACE_DIR=Join-Path $env:TEMP 'portfolio-pilot-turns-first'
node --env-file=apps/api/.env.local apps/worker/dist/index.js
```

`SESSION_ARTIFACT_DIR` is persistent. `AGENT_WORKSPACE_DIR` is temporary and must be an absolute
path outside the repository and personal agent configuration. On Windows, restrict the persistent
folder's access-control list, or **ACL**, to the worker identity, SYSTEM and administrators.

### Demonstrate a Worker Restart

1. Open `http://localhost:5173/assistant` and sign in as Alice using the local demo sign-in.
2. Select the Growth portfolio and create a conversation. Wait for ingestion to provide recent news.
3. Ask: **“Which recent news affects my largest holding?”** Wait for a completed answer that cites an article.
4. Stop only Terminal 4 with Ctrl+C. Keep PostgreSQL, Redis, the other workers and artifact storage.
5. Restart the agent worker with a new temporary workspace root:

```powershell
$env:AGENT_WORKSPACE_DIR=Join-Path $env:TEMP 'portfolio-pilot-turns-restarted'
node --env-file=apps/api/.env.local apps/worker/dist/index.js
```

6. In the **same conversation**, ask: **“Tell me more about that article.”**
7. Expected behavior: resumed continuity and an answer containing **“remembered by this session”**.
   The article is read again through authorized tools. A summary fallback uses different wording.

After a completed run, the transient root should contain no run directories. Persistent snapshots
remain under `.local/session-artifacts`; they contain sensitive context and must stay private.

### Optional Live Checks — Separately Gated and Not Yet Verified

For live Claude, supply `ANTHROPIC_API_KEY` and an account-supported `AGENT_MODEL_ID` in the server
environment, then deliberately enable the test:

```powershell
$env:RUN_LIVE_SDK_RESTART='true'
node node_modules/vitest/vitest.mjs run packages/agent/test/live-session-artifacts.test.ts -t 'LIVE Claude'
```

This performs two one-turn queries with estimated USD 0.05 SDK limits per query. These are usage
estimates, not guaranteed billing caps.

For live Blob, supply an **existing private container** through `SESSION_BLOB_CONTAINER_URL` and
workload identity through `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_FEDERATED_TOKEN_FILE`.
The last variable names the absolute path of the projected identity assertion file. Workload
identity lets the worker obtain an access token without storing an Azure account key. The identity
needs container-scoped Storage Blob Data Contributor access.

```powershell
$env:RUN_LIVE_BLOB_ARTIFACTS='true'
node node_modules/vitest/vitest.mjs run packages/agent/test/live-session-artifacts.test.ts -t 'LIVE Azure Blob'
```

This verifies upload/read/delete in its own unique test conversation scope. It does not provision
resources. Containers must disable anonymous access; the URL must have no SAS query string.
Application workers select this backend with `SESSION_ARTIFACT_BACKEND=azure`.

### Troubleshooting the Observed Windows Toolchain

The implementation machine's npm shim initially rejected delegated execution. The installed Node
and npm CLI worked when the Node installation directory was placed first on PATH. This exact
machine-specific workaround was used; adjust the path for your installation:

```powershell
$activityNodeDir='C:\Users\luisc\AppData\Local\Author Software\nvm\installs\v24.21.0'
$env:PATH="$activityNodeDir;$env:PATH"
& (Join-Path $activityNodeDir 'node.exe') (Join-Path $activityNodeDir 'node_modules/npm/bin/npm-cli.js') run build
```

Docker engine and Prisma engine-cache access initially failed because of filesystem permissions;
approved local access resolved those failures. If they recur on your machine, check Docker Desktop
and engine/cache permissions, then retry the same infrastructure or Prisma command. Do not interpret
an inaccessible database or missing native CLI as a successful skipped acceptance test.

## 5. Limitations and Unfinished Work

- **Mid-turn crashes:** an abrupt process/pod death loses the incomplete turn's runtime state. Begun
  attempts are failed without automatic replay. A new user turn can resume the last valid completed
  checkpoint. Previously approved application changes remain saved.
- **Missing or expired state:** missing, corrupt or expired artifacts cause explicitly labeled
  summary reseeding. Storage outages fail the run instead of silently pretending that resume worked.
  Older host-local bindings reseed once when moving to the durable-worker path.
- **Live verification:** live Claude and Azure Blob tests were skipped because their credentials and
  resources were absent. The SDK HTTP fixture and Blob mock contracts do not prove deployed Azure
  networking, role assignments or live model behavior.
- **Browser verification:** no milestone 28 browser test was run. The UI walkthrough above describes
  expected behavior supported by process tests, rather than an observed milestone 28 browser run.
- **Storage operations:** the local filesystem must support hard links and durable flushing.
  Windows requires operator-enforced private ACLs; POSIX creation uses 0700/0600 permissions.
  The shared worker identity remains a trust boundary, not an operating-system sandbox.
- **Retention:** snapshots expire after 30 days. Cleanup needs a scheduler/lifecycle backstop when
  workers stop. Azure soft-delete and native-version retention must also be bounded. There is no
  account/conversation deletion product endpoint yet; a future endpoint must call scoped deletion.
  SDK temporary directories abandoned by force-killing a process need OS/pod-volume cleanup.
- **SDK compatibility:** session-store APIs are marked alpha in SDK 0.3.276. Upgrades require
  re-verification of the snapshot format and restart tests.
- **Existing build warnings:** Vite reported third-party `use client` directives and a large bundle;
  Next.js reported three Node/Edge analysis warnings. The builds still passed. These were not fixed
  in this slice.
- **Release status:** no cloud resources were provisioned, no public deployment occurred and no
  commit was made because this workspace is not a Git repository. Security hardening is milestone 29.

## Further Reading

- [Project state and actual check results](docs/project-state.md)
- [Milestone sequence](docs/project-plan.md)
- [Lesson 28: session artifact persistence](docs/lessons/28-session-artifact-persistence.md)
- [ADR 0021: private completed-turn checkpoints](docs/decisions/0021-private-session-checkpoints.md)
- [Lesson 27: durable worker jobs](docs/lessons/27-durable-agent-worker.md)
- [Pinned versions and compatibility notes](docs/versions.md)
