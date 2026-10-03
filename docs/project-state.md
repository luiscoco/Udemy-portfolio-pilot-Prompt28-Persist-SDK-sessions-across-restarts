# PortfolioPilot — Project State

Single source of truth for progress. Update at the end of every milestone with **actual** results.

- **Last updated:** 2026-10-03
- **Last completed milestone:** 28 - Persist SDK sessions across restarts (PostgreSQL/mock process restart and actual SDK/CLI HTTP-fixture resume verified; live Claude/Blob unverified)
- **Next milestone:** 29 - Harden the application and execution boundary
- **Deployment status:** not deployed; no cloud resources exist.

## Milestone status

| # | Milestone | Status | Notes |
| --- | --- | --- | --- |
| 00 | Project contract and plan | Done | Documentation only |
| 01 | Verify versions and prerequisites | Done | Stable version matrix and local metadata in `docs/versions.md`; installation unverified because Node/npm are inactive and registry access fails locally |
| 02 | Scaffold the monorepo and shared contracts | Done | Install, build, typecheck, Vite proxy smoke check, and browser boundary check passed; generated Next.js instruction files remain pending approval to remove |
| 03 | Build the accessible frontend shell | Done | Six routes, responsive shell, demo fixtures, typed API client, query provider, Chrome desktop/mobile and keyboard smoke tests |
| 04 | Add the first Claude SDK vertical slice | Done | Local development question and answer, mock browser path verified; live call unverified without credentials |
| 05 | Start PostgreSQL and Redis locally | Done, live smoke blocked | Compose configuration, clients, health routes, docs, and local tests complete; Docker engine access denied |
| 06 | Create the Prisma schema and deterministic seed | Done | Fresh PostgreSQL migration, sequential/concurrent seed idempotency and ownership integration checks passed |
| 07 | Implement authentication and authorization | Done, live Entra unverified | Better Auth 1.7.7; PostgreSQL session/ownership acceptance and live API proxy smoke passed; OIDC credentials and browser UI verification unavailable |
| 08 | Build portfolio and transaction APIs | Done | Authenticated CRUD/archive, immutable trades, full ledger validation, DB locking and idempotency; eight new PostgreSQL acceptance tests passed |
| 09 | Implement valuation and performance calculations | Done | Exact rational decimal valuation, explicit quote status and authenticated owner-scoped summary; reference/edge tests and PostgreSQL acceptance passed |
| 10 | Connect the portfolio UI and watchlist | Done | Authenticated portfolio UI, exchange-aware owner-scoped watchlist CRUD, reference/refresh/two-user browser acceptance passed |
| 11 | Build deterministic provider adapters | Done | Clock-controlled mocks, reusable adapter contracts, authenticated snapshots, explicit mode/freshness and credential-free Chrome acceptance |
| 12 | Add live providers and resilient ingestion | Done, live unverified | Alpaca ADR/adapters, durable paginated worker ingestion, canonical/source aliases and history, fenced PostgreSQL lease, checkpoint/retry recovery; recorded contracts and real PostgreSQL acceptance passed |
| 13 | Implement caching and the transactional outbox | Done | Same-transaction OutboxEvent, leased/fenced dispatcher with bounded retry to owner-only Redis Streams, at-least-once with UUID dedupe, idempotent news fan-out, bounded retention/reset/snapshot recovery, versioned single-flight cache-aside; real PostgreSQL+Redis acceptance and live API/worker smoke passed |
| 14 | Build replayable authenticated SSE on the API | Done | Cookie-authenticated Node SSE, owner-bound signed composite replay cursors, independent per-process readers with cohort fan-out, bounded queues and session revalidation; real PostgreSQL/Redis acceptance and Next.js HTTP smoke passed |
| 15 | Add frontend streaming and snapshot recovery | Done | Auth-scoped shared StrictMode-safe SSE; validated notifications, targeted cache reconciliation, snapshot/replay/reset recovery and six Chrome browser tests |
| 16 | Build the complete live news experience | Done | Authenticated current-interest filters, keyset pagination, stable reading indicator, safe detail/provenance and decimal exposure, revision-aware read state; real ingestion/outbox/Redis/API SSE/two-user Chrome acceptance passed |
| 17 | Create authorized custom tools | Done, live Claude unverified | Six read-only SDK in-process MCP tools bound to an authenticated owner port; strict Zod, bounded/labeled results, domain arithmetic, built-ins disabled; 45 agent unit/protocol tests and 7 real PostgreSQL acceptance tests passed |
| 18 | Build grounded portfolio chat | Done, live Claude unverified | Owner-scoped Conversation/ChatMessage persistence and paginated endpoints, authorized context builder, versioned `portfolio-research-v1` instruction, validated-source Markdown, bounded single-process run coordinator; demo endpoint removed; real PostgreSQL acceptance and Chrome tests passed |
| 19 | Stream agent answers without duplicate text | Done, live Claude unverified | `includePartialMessages` mapped to typed run/block/tool events with per-message sequences; 202 run creation with pre-run replay cursor over the existing SSE channel; exactly-once persisted outcome; explicit cancel (abort + `Query.close()`); recorded fixtures, real PostgreSQL+Redis acceptance and Chrome tests passed |
| 20 | Implement resumable conversations and structured analysis | Done, live Claude unverified | Owner-scoped `ConversationSession` binding (separate from chat history) with host/config checks and CAS; documented `resume`/`persistSession`; honest new/resumed/reseeded continuity with an authorized summary seed; 409 for overlapping turns; `news-analysis-v1` via `outputFormat` with server reference validation, one retry, typed failures; fixtures, real PostgreSQL and Chrome acceptance passed; cross-pod persistence deferred to 28 |
| 21 | Build portfolio impact and research recommendations | Done, live Claude unverified | Shared revision/version/config cache with fenced PostgreSQL claims; owner-scoped deterministic exposure/recommendations, persisted provenance, correction/ledger invalidation and stale evidence; 11 PostgreSQL and 1 Chrome acceptance tests passed |
| 22 | Add recommendation cards and configurable alerts | Done, live Claude unverified | Durable owner-scoped history/save/dismiss, deterministic alert thresholds, revision dedupe/cooldowns, outbox/SSE recovery; PostgreSQL/Redis/API acceptance 4/4 and Chrome E2E 1/1 passed |
| 23 | Add focused subagents and an MCP integration | Done, live Claude unverified | Optional minimal-tool SDK specialists, owner-bound external stdio MCP wrapper/fixture, depth/concurrency/tool/usage bounds, sanitized delegation status; actual process adversarial tests and PostgreSQL/Redis acceptance passed; mock latency/usage measured, live experiment gated |
| 24 | Add reusable skills and policy hooks | Done, live Claude briefing unverified | Two managed application skills, explicit cwd/config sources, composed SDK policy/audit hooks; actual credential-free SDK isolation startup, PostgreSQL ownership/audit acceptance and compiled API HTTP smoke passed |
| 25 | Implement approvals and explicit cancellation | Done, live Claude unverified | Durable exact approval binding, authenticated cards/endpoints, one-time atomic consumption/outbox, state/revision checks and cancellation fencing; PostgreSQL and Chrome acceptance passed |
| 26 | Manage context and enforce usage budgets | Done, live Claude unverified | Configurable SDK/app limits, runtime model and estimate telemetry, atomic UTC daily reservation/reconciliation, conservative crashes, source/scope-preserving summaries, terminal UI states; PostgreSQL and Chrome acceptance passed |
| 27 | Move execution into a durable worker | Done, live Claude unverified | PostgreSQL queued jobs, SKIP LOCKED claims, fenced conversation/run leases, heartbeat/cancel, deliberate crash recovery, bounded chunks/outbox; API restart and Chrome acceptance passed |
| 28 | Persist SDK sessions across restarts | Done, live Claude/Blob unverified | Private local/Blob immutable snapshots, opaque main/subagent transcripts, SDK resume, fenced atomic publication, integrity/retention/cleanup; PostgreSQL worker restart and actual CLI HTTP-fixture acceptance passed |
| 29 | Harden the application and execution boundary | Not started | |
| 30 | Add distributed recovery and operational controls | Not started | |
| 31 | Build a meaningful automated test suite | Not started | |
| 32 | Add AI evaluation and observability | Not started | |
| 33 | Build production containers and release CI | Not started | |
| 34 | Generate and validate Azure infrastructure | Not started | |
| 35 | Create Kubernetes deployment and release procedures | Not started | |
| 36 | Finish the capstone and teaching materials | Not started | |

## Environment observed (2026-09-30)

| Tool | Observed | Notes |
| --- | --- | --- |
| OS | Windows 11 Home (10.0.26200) | PowerShell and Git Bash available |
| Node.js | 24.21.0 installed under nvm, **not active** in this shell | `node --version` reports no active version; Node 24 is LTS |
| npm | **Not active** in this shell | Node 24.21.0 bundles npm 11.19.0 per official archive |
| git | 2.52.0.windows.1 | `git status --short` says this workspace is not a Git repository; the earlier observation no longer matches this directory |
| Docker | CLI 28.5.2; Compose 2.40.3 | `docker info` fails with access denied to config/engine pipe; daemon unverified |

## Environment observed (2026-10-02, milestone 19)

Node.js 24.21.0 / npm 11.19.0 are now active in this shell. Docker engine access works: the
`portfolio-pilot-local` PostgreSQL/Redis containers and the `portfolio-pilot-m06-verify`
PostgreSQL test container (port 5546) were running. The workspace is still not a Git repository.

## Environment observed (2026-10-02, milestone 20)

Same as milestone 19: Node.js 24.21.0 / npm 11.19.0 active, Docker engine reachable,
`portfolio-pilot-local` PostgreSQL/Redis and `portfolio-pilot-m06-verify` (port 5546) running.
`node_modules` was absent at the start and was restored with
`npm ci --ignore-scripts --offline --cache .npm-cache` (0 vulnerabilities). Not a Git repository.

## Latest milestone report - 28

**What works:** `SessionArtifactStore` has private local-persistent and Azure Blob REST implementations.
Snapshots preserve SDK 0.3.276 opaque main/subagent transcript entries and metadata, rather than
reconstructing runtime state from application chat or treating a session ID as sufficient. Dedicated
run cwd/config workspaces are created after conversation lease acquisition. Supported
`sessionStore + resume` hydrates runtime files via the SDK's own unique temporary config directory.
Auto-memory is disabled; managed skills/config are recreated from versioned source. SHA-256,
owner/conversation hashes, session/model/instruction/SDK metadata, immutable unique object keys and
16 MiB limits are checked. SDK mirror failures prevent checkpoint publication. Snapshot reference,
session generation and completed answer/events commit atomically under the live run/conversation
fence; stale, failed and cancelled attempts preserve the previous valid checkpoint. Missing/corrupt
or expired snapshots are visibly summary-reseeded, while outages fail closed. Local publication
flushes an exclusive temporary file/hard link; Blob uses Entra federation/refresh, private-container
checks and conditional create, without SAS/public URLs. Thirty-day retention sweeps remove old and
orphan versions; scoped deletion is available server-side. Normal exits clean run workspaces;
subsequent run setup removes marked >24h-abandoned cwd directories. Abrupt mid-turn death fails that
attempt; a new user turn can resume the last completed checkpoint without replaying approved changes.

**Changed files:** Created `packages/agent/src/session-artifacts.ts`, `azure-session-artifacts.ts`;
agent storage, actual SDK/CLI HTTP-fixture restart and gated live tests; modified agent `index.ts`
and `streaming.ts`. Modified DB schema/chat service, added `20261015100000_session_artifacts` and
`20261015101000_session_artifact_constraint` migrations (the second closes SQL CHECK's nullable
checksum loophole without rewriting the first already-applied acceptance migration).
Modified server config; worker `agent.ts`, `agent-execution.ts`, `.env.example`; created worker
`agent-artifacts.ts`, cleanup unit test and PostgreSQL process-restart acceptance suite. Added ADR
0021 and lesson 28; updated decisions index, versions, appended the persistence follow-up to ADR
0013 and updated this state. No dependency/lockfile versions or instruction files changed. Generated
Prisma/build outputs were refreshed locally; this workspace is not a Git repository.

**Check results:** `npm ci --ignore-scripts --offline --cache .npm-cache` installed 348 packages,
0 vulnerabilities. Native npm shim was blocked; commands used the installed Node 24.21.0/npm
11.19.0 CLI with its directory first in PATH. Prisma generation passed and `prisma migrate deploy`
applied all **18** migrations to isolated loopback `portfolio_m28_verify` (port 5546), initially
created fresh for this milestone. The final acceptance run also rejects partial/null-checksum pointers.
Docker/Prisma cache initially required elevated access; approved local access resolved both.
`npm run typecheck`, `npm run build` and `node scripts/check-browser-boundary.mjs` passed. Build
reported the existing Vite directive/large-chunk warnings and three Next.js Node/Edge-analysis
warnings. `npm run test` passed **294** tests with **118** gated tests skipped. The first regression
run exposed a worker-only persistent-volume requirement being applied to API startup; that check
was moved to agent-worker store construction and the complete rerun passed.
Final focused credential-free command ran **9 passing tests**, **2 live tests skipped**: seven
local/Blob-mock storage contracts, one actual installed SDK/CLI loopback HTTP model restart and one
abandoned-workspace cleanup test. PostgreSQL acceptance passed **6/6** against actual worker
processes: empty-workspace restart/article recall, missing and corrupt recovery, competing restores,
stale checkpoint and crash recovery, generation CAS/cancellation. The initial integration setup
failed on an unexported seed helper import; the corrected suite passed. Neither live Claude nor live
Blob was run; skips are not reported as live verification. No browser test was run for this backend slice.

**How to demonstrate:** Exact database setup/test and browser worker-stop/restart steps are in
`docs/lessons/28-session-artifact-persistence.md`. After `npm run build`, run
`node node_modules/vitest/vitest.mjs run packages/agent/test/session-artifacts.test.ts packages/agent/test/sdk-checkpoint-restart.test.ts apps/worker/test/agent-artifacts.test.ts`.
Set `SESSION_ARTIFACT_TEST_DATABASE_URL` to the migrated isolated loopback database above and run
`node node_modules/vitest/vitest.mjs run apps/worker/test/session-artifacts.integration.test.ts`.
For the UI, complete a mock news turn, stop the agent worker, change `AGENT_WORKSPACE_DIR` to a new
empty absolute root while preserving `SESSION_ARTIFACT_DIR`/PostgreSQL, restart, and ask about that
article in the same conversation. Existing continuity UI reports resumed; mock text distinguishes
session recall from summary fallback.

**Remaining limitations:** Live Claude needs server `ANTHROPIC_API_KEY`/`AGENT_MODEL_ID`; the exact
next command is `RUN_LIVE_SDK_RESTART=true` with
`node node_modules/vitest/vitest.mjs run packages/agent/test/live-session-artifacts.test.ts -t 'LIVE Claude'`
(PowerShell environment syntax is in lesson 28). Live Blob needs an existing private container and
projected workload-identity credentials; set `RUN_LIVE_BLOB_ARTIFACTS=true`,
`SESSION_BLOB_CONTAINER_URL`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_FEDERATED_TOKEN_FILE`, then
run the same test file with `-t 'LIVE Azure Blob'`. No resources were provisioned or deployed.
SDK session-store APIs are alpha/pinned; upgrades require re-verification. Windows local privacy
requires private directory ACLs; POSIX uses 0700/0600 and requires hard-link/fsync support. The
shared worker is not an OS sandbox. Worker sweeps need an external lifecycle/scheduler backstop
when workers stop; Azure soft-delete/version retention must also be bounded. No account/conversation
deletion product endpoint exists yet; it must invoke the supplied scoped deletion method when added.
SDK hydration directories abandoned by SIGKILL require OS temp/pod-volume cleanup. Mid-turn state
is not recoverable; completed-checkpoint restart is the supported guarantee. Older host-local
bindings truthfully reseed once. Full Azure/network/identity deployment remains future work.

### Student README follow-up — 2026-10-03

Created the missing root `README.md` for milestone 28. It explains purpose and terminology, the
actual implementation sequence and changed files, recorded test results, prerequisites and commands,
an interactive mock worker-restart demonstration, separate live gates, and known limitations.
The UI recipe includes ingestion so recent mock news is available despite the older seed timestamp.
Historical check results are explicitly labeled; the alternative student test-container recipe
and milestone 28 browser walkthrough are instructions, not newly observed verification.
Static PowerShell validation passed: five required sections, 36 balanced fence markers, 12 existing
unique local link targets and referenced npm scripts checked against their manifests. No application
code changed and application/build/integration/live/browser checks were not rerun for this follow-up.
Only README, this state note and the lesson follow-up were changed.

A subsequent README review preserved the existing content and added navigation, definitions of
SDK/CLI/UUID, a comparison of chat history versus SDK artifacts versus checkpoint references, and
links explaining each new test file. The implementation command record was corrected to show the
direct Prisma invocation actually used. Static checks passed for five required sections, 38 balanced
fence markers, 17 existing unique local targets, five navigation anchors and npm scripts. This
review also changed only documentation; no application checks were rerun.

## Previous milestone report - 27

**What works:** Authenticated submission atomically persists queued AgentRun/user message and budget
reservation. The API no longer launches chat or mistakes a remote worker for a lost callback.
Independently selected agent workers claim conversation/run rows with SKIP LOCKED, increment job
attempts, heartbeat 30-second leases every five seconds and check durable cancellation. Queued,
running, waiting_for_approval, completed, failed and cancelled states persist. Result, progress,
session-binding and approval-consumption writes require matching unexpired worker/attempt and
conversation leases. Only never-started claims without progress/proposals retry (at most three
claims). Begun work becomes visibly interrupted, with unused grants invalidated and uncertain
spend conservatively charged; consumed mutation receipts remain committed/idempotent. The migration
marks legacy active API runs as already begun. Bounded visible batches commit with outbox rows;
final message, journal/outbox, budget, approval invalidation and lease release commit once.
Owner-only chunk recovery repairs browser reload/sequence gaps independently of worker memory
and Redis retention. Queued cancellation records not_started usage and zero cost, without falsely
labeling a live-mode request as mock. Final messages replace drafts without duplicates. Healthy waiting approvals
can be granted through a restarted API. Browser disconnect does not cancel a job.

**Changed files:** DB schema/migration, agent-jobs/run-lease/run-progress, chat/approvals/owner
capability/exports; worker agent role, extracted execution/batching/money and env example; API
submission/cancel/inspection/approval routes and chunks endpoint; contracts/browser recovery/store;
worker PostgreSQL acceptance, migrated chat/session/budget/approval test worker fixtures, Chrome
E2E and two verifier scripts; cache ignore, ADR 0020, lesson 27 and state. The API coordinator moved
to historical test fixtures and its runtime publisher was removed. Generated Prisma/build outputs
refreshed. No instructions changed, dependency upgrades, commits, pushes or deployment.

**Check results:**

- `npm ci --ignore-scripts --offline --cache .npm-cache`: 348 packages, zero vulnerabilities.
  NVM npm delegation initially failed; installed Node 24.21.0/npm 11.19.0 with explicit PATH worked.
  Prisma cache EPERM was resolved using an existing schema-engine copy within the workspace.
- `prisma migrate deploy --config packages/db/prisma.config.ts`: 16 migrations applied to fresh
  local portfolio_m27_verify on port 5546; final deploy reported no pending migrations. During
  development the new migration was ordered after budgets and its FK aligned to ON UPDATE CASCADE;
  only this disposable DB's new migration metadata was aligned. No application history was edited.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test` and
  `node scripts/check-browser-boundary.mjs`: passed. Final default suite **285 passed, 110 opt-in
  skipped**. Existing Vite directives/large-bundle and three Next instrumentation Edge warnings
  remain. An accidentally compiled test copy was removed; acceptance now lives in worker/test.
  After the no-query usage-label correction, affected typechecks and API/web rebuilds passed;
  contracts/web unit tests (15/15 and 30/30), durable jobs (8/8) and budgets (13/13) passed again.
  The cancellation fixture now explicitly waits for query invocation before asserting uncertain cost.
- With AGENT_JOBS_TEST_DATABASE_URL set: `vitest run --root apps/worker
  test/agent-jobs.integration.test.ts`: **8/8 passed**. Competing claims, stale result/session/
  progress/heartbeat rejection, safe pre-start reclaim, bounded transactional journals, one final
  message, conservative crashes, queued cancellation, approval idempotency/fencing and two actual
  workers verified. One run under simultaneous build load exceeded the unchanged five-second test
  timeout; the final isolated run passed (8.86s total).
- Prior PostgreSQL suites run with their URL variables pointing to this isolated DB: budgets
  **13/13**, approvals **13/13**, sessions/analysis **10/10**, PostgreSQL+Redis streamed chat **8/8**
  passed. Fixtures explicitly claim workers and provide recorded usage for safe retries; production
  guards were preserved. Initial legacy assumptions and test harness races were corrected.
- `node scripts/verify-agent-worker.mjs`: passed with compiled Next HTTP and separate mock agent/
  outbox processes. API restart during an answer and approval, remote cancellation, killed-worker
  interruption/unused grant invalidation, sequenced authorized recovery, published outbox/SSE and
  one final message verified. Initial harness cleanup and incorrect first-frame assumptions were
  corrected. An initial 503 read did not recur in the final isolated run; sanitized error-kind
  logging was added without error messages or secrets.
- `node scripts/verify-agent-browser.mjs`: **1/1 installed Chrome passed**, 34.9s. Queued submission
  with no worker, durable partial text after reload, one final answer and remote cancellation
  without a pending mutation verified. Verifiers stop their own API/Vite/workers.
- `prisma migrate diff --config packages/db/prisma.config.ts --from-config-datasource --to-schema
  packages/db/prisma/schema.prisma --exit-code`: **exit 2**, older ApprovalRequest/NewsRead FK
  update actions and Recommendation evidence GIN-index differences. No new job/chunk drift remains.
  This is a known earlier schema/migration gap, not a passing drift check.

**How to demonstrate:** Follow [lesson 27](lessons/27-durable-agent-worker.md): migrate/seed the
local DB, build, set AGENT_JOBS_TEST_DATABASE_URL to portfolio_m27_verify, and run the two verifier
scripts sequentially. For interactive use run `npm run dev`, plus agent/outbox workers using the
same server env. At /assistant sign in, send an answer, restart only the API and reload. Propose a
known stock watchlist addition, restart the API while waiting, then approve/cancel. Kill a worker;
after its 30s lease expires an available worker shows interruption. Submit a new request deliberately.

**Remaining limitations:** Live Claude unverified without application credentials. After configuring
existing worker API key, operator-selected model and isolated workspace, run
`$env:WORKER_ROLE='agent'; node --env-file=apps/api/.env.local apps/worker/dist/index.js` and repeat a
focused answer/approval/cancel. SDK artifacts remain host-local until 28; another host honestly
reseeds history. API/worker limits/model/mode must share server configuration. One job executes per
worker; recovery requires an available worker/database and can wait behind its current job.
External provider execution cannot be stopped instantly by a partition; fences prevent stale
results and mutations. Fleet limits, retention/admin/monitoring remain 30. Older Prisma drift and
its exact inspection command are recorded above. Not a Git repository; nothing deployed.

**Documentation follow-up (2026-10-03):** Created the missing root `README.md` for activity 27.
It explains purpose, implementation sequence/files, durable-worker behavior, recorded acceptance
results, local startup, isolated verification and remaining limits. The Compose-based test database
recipe is explicitly distinguished from the previously executed port-5546 setup. Static PowerShell
validation passed: six required headings, 18 balanced code-fence markers, 10 existing local link
targets and all referenced root npm scripts. Only README, this note and lesson 27 changed;
application builds/tests, Docker setup and live Claude checks were not rerun for this follow-up.

**Documentation follow-up (2026-10-03):** Created the missing root `README.md` for activity 27.
It explains purpose, implementation sequence/files, durable-worker behavior, recorded acceptance
results, local startup, isolated verification and remaining limits. The Compose-based test database
recipe is explicitly distinguished from the previously executed port-5546 setup. Static PowerShell
validation passed: six required headings, 18 balanced code-fence markers, 10 existing local link
targets and all referenced root npm scripts. Only README, this note and lesson 27 changed;
application builds/tests, Docker setup and live Claude checks were not rerun for this follow-up.

## Previous milestone report - 26

**What works:** Interactive AgentRun requests enforce server-configured model, UTF-8 prompt and
serialized tool-result size, main turns, wall time and estimated cost. SDK options and application
guards compose; retries share remaining limits and uncertain usage blocks further paid attempts.
Runtime init/main-message model is recorded, with whole-tree result usage; partial/child totals are
not added twice. Cost is an SDK estimate, billed usage is unknown, mock mode costs zero. Exact
integer microdollars/PostgreSQL numeric protect monetary accounting. A conditional PostgreSQL
UTC-day reservation commits atomically with run/user-message creation. Concurrent reservations
cannot exceed the daily allowance; rejection returns 429 without a run/draft/message. Exactly-once
completion reconciles usage, including overruns; uncertain/crash outcomes retain the full
reservation conservatively. Outstanding reservations still block after a process loss. Explicit
context resets seed a new session from owner-scoped saved history across pages, preserving source
references, exact user scope requests, current portfolio scope and old-analysis/fresh-data labels.
Too-large context or truncated full-scope lookups fail visibly. Timeout, cancellation and limit
outcomes finish durable messages/events and leave the composer usable.

**Changed files:** Created daily-budget helper/migration, exact-money helper/test, PostgreSQL
budget acceptance suite, SDK limit tests, Chrome budget/context scenario, ADR 0019 and lesson 26.
Modified server config/env example, contracts/error envelope, DB schema/chat service/error status,
agent live/mock/streaming/usage/context/tool boundaries, API coordination/composition/HTTP mapping,
assistant usage/continuity/error UI and existing fixture assertions. Versions and ADR index updated;
generated Prisma/build outputs refreshed. Full grouped inventory is in lesson 26. No source removed,
instruction files overwritten or dependency upgrades. Workspace is not a Git repository.

**Check results:** Offline install passed (348 packages, zero vulnerabilities). All fifteen migrations
applied to fresh local portfolio_m26_verify. Workspace typecheck, lint, production build and browser
boundary passed. Credential-free workspace suite passed 282 tests, 99 opt-in skipped at that run;
later additional cases passed in the focused suite. Final agent suite: 133 passed, two live skipped.
Final PostgreSQL budgets/coordinator/exact-money suite: 17/17. Chrome scenario: 1/1, using actual
API/Vite/PostgreSQL/Redis, verifies selected-scope reset, timeout, cancellation and HTTP 429 with
enabled composer. Final DB compile/acceptance and API/web compile passed after lock-order/error
wording changes; final mock size/parallel-turn compilation and focused regression passed 27/27.
Existing Vite directives/large-bundle and Next Edge instrumentation warnings
remain. NVM shim/cache execution issues were resolved using installed entry points and a local
cached Prisma engine copy; the first prompt test and browser seed identity assumption were fixed
before passing. No failing checks remain; live Claude tests were skipped without credentials.

**How to demonstrate it:** [Lesson 26](lessons/26-context-and-usage-budgets.md) contains exact
migration/seed/start/test commands and local Windows workarounds. With mock mode,
AGENT_CONTEXT_RESET_TURNS=1 and AGENT_WALL_CLOCK_MS=3000, sign in as Alice, select Growth,
create a conversation and ask `What do I own?` twice. Observe the reset note and preserved scope.
Leave a watchlist proposal waiting to see timeout; repeat and cancel promptly. Run the dedicated
budget suite to demonstrate twelve concurrent reservations admitting exactly three under $0.60,
and the Chrome scenario to demonstrate exhausted-budget rejection without a hanging draft.

**Remaining limitations:** Native live model generation/limit telemetry is unverified without
Anthropic credentials; the exact next live configuration and `npm run dev` demonstration are in
lesson 26. SDK cost limits and overflow reserves are approximate quota controls, not guarantees
about an authoritative invoice. Conservative crash charges can reduce that day's available quota.
The daily ledger covers interactive AgentRun trees; shared cached public article analysis retains
its existing separate service caps. Execution, approval callbacks and SDK artifacts remain local
until milestones 27/28/30. No paid resources, push or public deployment. Temporary API/Vite
processes were stopped (ports 3001/5173 confirmed stopped); the dedicated DB remains for inspection.

## Latest milestone report - 25

**What works:** Assistant watchlist additions and full alert replacements require explicit user
approval. PostgreSQL ApprovalRequest records owner/run, exact validated arguments, action/hash,
prior state, mutation UUID, status and UTC expiry. Authenticated, origin-protected approve/reject
endpoints bind the displayed hash; cards show before and exact after, recover after reload, and
support rejection/cancellation. SDK PreToolUse asks and documented canUseTool waits, without
preapproving writes or installing reusable permissions. Handlers independently require the exact
receipt; ownership, schema/hash, expiry, active run, cancellation and current resource/revision are
rechecked. Consumption, domain mutation and owner outbox event commit atomically; duplicate use
returns the persisted receipt. Cancellation and completion share the run lock and revoke pending
writes. Already committed approved changes remain saved. Lost waiting callbacks fail safely on
reconciliation/access; an explicit new user proposal creates a fresh run/approval.

**Changed files:** Created approval contract/service/migration, agent approval tools/tests, three
API routes and database acceptance suite, Chrome approval scenario, ADR 0018 and lesson 25.
Modified run contracts/schema/chat repository, agent contexts/MCP/options/policy/adapters/prompt,
API authorization/run composition, assistant cards/styles, versions and ADR index. Generated clients
and build artifacts refreshed. No source removed; see lesson 25 for the full grouped inventory.

**Check results:** Offline install succeeded (348 packages, zero vulnerabilities). Build:types and
workspace typecheck passed; all fourteen migrations applied to fresh local portfolio_m25_verify.
Workspace mock tests: 276 passed, 88 opt-in skipped (before the final extra cancellation case).
Approval/coordinator PostgreSQL suite: 16/16; final approval-only rerun: 13/13. SDK permission
integration: 3/3. Chrome approval/reload/owner/reject/cancel/mobile scenario: 1/1. Production build
passed with existing Vite directives/large-bundle and three Next Edge instrumentation warnings.
Final DB compile/API typecheck and web compile passed after small expiry/status edits. Browser
boundary passed. Initial NVM shim/cache restrictions were resolved with installed entry points and
approved Prisma cache access. Browser test sign-in/composer assertions were corrected before pass.

**How to demonstrate it:** Exact environment/migration/seed/start and test commands are in
[lesson 25](lessons/25-approvals-and-explicit-cancellation.md). In mock mode sign in as Alice,
create a conversation, send `Add ACME on XNYS to my watchlist`, inspect the exact card, reload,
and approve within 60 seconds. Repeat with another unused stock and reject/cancel. Alert-rule
mock proposals use the documented exact JSON prompt; live mode can discover owned rule IDs via
listAlertRules. Restart during a pending approval to demonstrate safe failure/new confirmation.

**Remaining limitations:** Native Claude approval flow was not called without credentials; the
exact live configuration/demo command is in lesson 25. Callback coordination remains one process;
multi-replica routing, durable workers and session artifacts are later milestones. No paid resources,
public deployment or push occurred. This workspace is not a Git repository. Local PostgreSQL test
DB remains for inspection; temporary browser/API dev processes are stopped after verification.

## Latest milestone report — 24

**What works:** Reusable daily portfolio briefing and earnings-news review instructions are shipped
under `packages/agent/runtime/skills` and installed as exact managed bytes under the dedicated
application `AGENT_WORKSPACE_DIR/skills`. Live chat explicitly sets cwd and CLAUDE_CONFIG_DIR to that
absolute directory, uses only its overridden `user` configuration source, excludes project/local
sources, specifies two exact skill names, disables cloud skill/plugin sync and keeps strict SDK MCP
configuration with empty plugins. Personal configuration paths, unmanaged runtime configuration,
extra resources, symlinks and modified skill instructions are rejected without overwriting them.
Shell/filesystem/web/mutations remain denied; only Skill is newly enabled on the main thread.
Article analysis stays tool/skill/settings-free. Session model identity includes skills-policy-v1.

SDK PreToolUse complements owner checks in handlers, composing the prior specialist policy;
PostToolUse/PostToolUseFailure emit sanitized audit outcomes, including MCP isError results. Audit
identity comes from authenticated actor and persisted conversation/run, with UTC time, exact known
tool name and fixed phase/subagent/skill metadata. Arguments, responses, errors, SDK paths/session
IDs, hidden reasoning and secrets are discarded; arbitrary tool names are redacted. The default
sink emits JSON server logs. Pre-tool audit failure denies execution. Specialists cannot invoke skills.

Credential-free mock answers identify the skill and simulation, use its managed headings and the
same authorized tools, and replay the audit callbacks. A skill is reusable instruction text; a tool
executes a schema-validated read. Real PostgreSQL acceptance demonstrates that a generic read can
pass the hook and still fail Bob's attempt to access Alice's portfolio inside the owner-bound tool.

**Changed files:** Created `packages/agent/src/application-skills.ts`, `src/policy-hooks.ts`,
`runtime/skills/daily-portfolio-briefing/SKILL.md`, `runtime/skills/earnings-news-review/SKILL.md`,
`test/skills-policy.test.ts`, `test/skills.live.test.ts`, ADR 0017 and lesson 24. Modified agent
index/streaming/mock/delegation and four existing adapter/config/session tests; API chat composition,
agent-tools integration acceptance and `.env.example`; versions, ADR index and this state.
Generated build outputs and existing comparison test artifact refreshed. No dependency/lockfile
changes, removed files, instruction-file overwrites, commits, push, deployment or cloud provisioning.
Workspace is not a Git repository, so a Git diff is unavailable.

**Check results (2026-10-02):**

- `npm ci --ignore-scripts --offline --cache .npm-cache` passed: 348 packages, zero audit
  vulnerabilities. Used installed Node 24.21.0 / adjacent npm-cli.js with its directory on PATH.
- `npm run build:types`, `npm run typecheck`, `npm run lint`, `npm run build` and
  `npm run check:browser-boundary` passed. Initial build:types/typecheck hit the known Prisma cache
  EPERM utime; reruns supplied the existing cached engine through PRISMA_SCHEMA_ENGINE_BINARY.
  A direct run-workspaces invocation was rejected because it requires npm; all actual workspace
  checks subsequently ran via npm-cli.js. No dependency or permission settings changed.
- `DATA_MODE=mock npm run test` passed **273 tests**, with **76 opt-in tests skipped** (63 API,
  11 worker, two live Claude tests). Final agent suite passed **124/124**, two live tests skipped.
  Focused skill/policy suite passed **7/7** after the final runtime/assets changes.
- The actual installed SDK subprocess starts from an empty runtime, discovers both application
  skills, confirms hook registration and excludes planted personal/ancestor skills and MCP settings.
  No prompt is sent, no model is called and no Claude credentials are supplied. A second managed
  preparation succeeds after CLI startup; changed files/personal config paths are rejected.
- `AGENT_TOOLS_TEST_DATABASE_URL=.../portfolio_m22_verify` with loopback PostgreSQL port 5546:
  `vitest run lib/agent-tools.integration.test.ts` passed **9/9**. New acceptance verifies briefing
  headings, real persisted decimal valuation/news, correlated actor/conversation/run audit and
  foreign ownership denial after the hook permits the tool name.
- With dedicated `portfolio_m19_verify` and loopback Redis DB 11,
  `vitest run lib/chat.integration.test.ts lib/agent-run-events.test.ts` passed **11/11** for
  authenticated routes, persistence, replay/cancellation and owner isolation.
- A `node --input-type=module` HTTP smoke launched the compiled `next start` API on loopback 3014
  with development-only demo authentication and the disposable verification DB. Real Alice sign-in,
  conversation/run creation, completed persisted briefing, all five headings, skill marker and
  correlated JSON audit passed. Child stopped and its conversation was removed afterwards.
  This verifies compiled asset resolution; it is not production auth or browser visual verification.
- Final `npm run build -w @portfolio-pilot/api` passed after making skill file reads statically
  explicit and excluding external runtime paths from source tracing. The new whole-project tracing
  warning was resolved. Existing Vite directive/chunk-size and three Next instrumentation Edge
  warnings remain.

**How to demonstrate it:** Exact commands and UI steps are in
[lesson 24](lessons/24-application-skills-and-policy-hooks.md). Run `npm run build:types`, configure
the seeded local mock demo and `npm run dev`. Sign in as Alice, scope an Assistant conversation to
Growth, ask "Give me a daily portfolio briefing", inspect the five headings/labels and Skill used
marker, then ask "Review earnings news" for its four headings. Inspect `agent.tool.audit` in API
stdout by run ID. Run the lesson's focused policy suite to demonstrate denied Bash/trade operations
and the credential-free SDK isolation startup.

**Remaining limitations:** Actual Claude Skill invocation/model adherence requires securely supplied
ANTHROPIC_API_KEY, verified AGENT_MODEL_ID and a clean absolute AGENT_WORKSPACE_DIR. Next command:
`RUN_LIVE_SKILLS_TEST=true npm run test -w @portfolio-pilot/agent -- test/skills.live.test.ts`
(PowerShell assignments in lesson 24). This opt-in one-run test has $0.10/ten-turn/60-second caps;
it was skipped without those prerequisites. No native model success is claimed from mock replay.
No browser visual test was run. Audit events currently go to server logs rather than a durable
audit repository/retention service. Runtime directory separation is not an OS sandbox; SDK transcripts
are sensitive and host-local. Distributed worker/session storage and production container packaging
remain milestones 27/28/33. Milestone 25 approval workflow has not been implemented.

## Previous milestone report — 23

**What works:** Optional news-research and portfolio-risk native SDK definitions have separate
instructions and minimal tools. Main agent owns the final answer and existing authorized article
evidence/citation validation. The same authenticated repository capability reaches all specialist
handlers. External research exports only an authorized symbol/exchange through a fixed stdio tool,
with a synthetic credential-free fixture and a configurable reviewed live Node.js script path.
External evidence is supplementary; it cannot register private article citations.

Depth 1/concurrency 2, built-in agents disabled, one foreground call per specialist, no nested/resumed
delegation, 24 tool attempts, three specialist turns, main default six turns/$0.10/60 seconds.
Observed complete-message tokens include children and deduplicate repeated content blocks; final
aggregate modelUsage/cost checked separately against 100,000 tokens and SDK cost cap. Delegation
missing aggregate telemetry fails closed. Budget checks are response-boundary checks with possible
in-flight overshoot. Child text/reasoning is suppressed; only sanitized application delegation/tool
status and main answer text reach SSE. No subagent token-streaming claim.

MCP: exact researchSecurity allowlist, owner check before process launch, dedicated live token,
safe OS environment defaults, 3-second deadline, two calls, 32 KiB transport buffer and 12,000-byte
full output bound. Authentication/protocol/timeout/size/invalid-URL/cancellation failures produce
fixed bounded messages. Claude child environment no longer inherits application credentials.
Credential-free mock simulates both specialists, combines supported evidence in its final cited
answer and invokes the actual fixture process. Existing simple path remains default.

**Changed files:** Created agent `src/delegation.ts`, `src/research-mcp.ts`,
`src/fixture-research-server.ts`, `src/instructions/specialists.ts`, `test/delegation.test.ts`,
`test/research-comparison.live.test.ts`, `test/fixtures/research-boundary-server.mjs`, ADR 0016 and
lesson 23. Modified agent index/streaming/mock adapter/manifest/test owner port; config server/tests;
contracts agent-events; API chat composition, env example and real ownership acceptance; web chat
status labels; lockfile metadata, versions, ADR index and this state. Generated build outputs refreshed.
No dependencies upgraded, files removed, instruction files overwritten, commits, push, deployment or
cloud provisioning. Workspace is not a Git repository.

**Check results (2026-10-02):**

- Offline `npm ci --ignore-scripts --offline --cache .npm-cache` restored 348 packages; offline
  lockfile update passed, zero audit vulnerabilities. NVM npm shim failed NVM4306; actual npm
  commands used installed Node 24.21.0 with adjacent npm-cli.js and its directory prepended to PATH.
- `npm run typecheck`, `npm run lint` (TypeScript), `npm run build`, and
  `npm run check:browser-boundary` passed. Prisma cache utime initially failed EPERM; pointing
  PRISMA_SCHEMA_ENGINE_BINARY at the existing readable cached engine allowed generation. Existing
  Vite directive/chunk-size and three Next instrumentation Edge warnings remain. Final API build
  rerun validates the final agent changes.
- `DATA_MODE=mock npm run test` passed **265 tests**, with **74 opt-in tests skipped** (62 API,
  11 worker, 1 live Claude comparison). Final focused agent suite after the added missing-telemetry
  regression passed **117/117**, with its one live comparison skipped. Config passed **8/8**.
  Agent coverage includes actual fixture/live-contract stdio processes, denied credentials,
  hanging/oversize/malformed results, cancellation, environment isolation, policy and usage caps.
- `AGENT_TOOLS_TEST_DATABASE_URL` on disposable `portfolio_m22_verify`:
  `vitest run lib/agent-tools.integration.test.ts` passed **8/8**, including all delegated MCP
  private paths attempted by Bob with Alice's IDs and both mock specialists contributing real
  repository evidence. No fake repository result substituted for this acceptance.
- With specialists=true, MCP=fixture, CHAT_TEST_DATABASE_URL on its required `portfolio_m19_verify`
  and loopback Redis DB 11, `vitest run lib/chat.integration.test.ts lib/agent-run-events.test.ts`
  passed **11/11**: real authenticated routes, final citations, late SSE replay, cancel and owner
  isolation. First invocation was refused by the test's exact database guard; second exposed overly
  broad specialist news scope for the largest-holding question. Main mock planner now resolves
  that scope before assigning news work; final run passed without weakening citation expectations.
- Final recorded mock comparison: single **3 ms / 3 owner-port calls**, delegated fixture
  **399 ms / 8 calls**; both **0 model tokens / $0**. Artifact:
  `packages/agent/test-results/m23-comparison.json`. This is mock/tool overhead, not native model
  performance. Real nested usage and live latency were not observed.

**How to demonstrate it:** Follow [lesson 23](lessons/23-specialists-and-research-mcp.md).
Build shared packages, enable AGENT_SPECIALISTS_ENABLED=true and RESEARCH_MCP_MODE=fixture with
DATA_MODE/AGENT_MODE=mock, run `npm run dev`, sign in as Alice, scope an Assistant conversation
to Growth and ask "Research recent news and portfolio risk". Inspect sanitized progress, the final
cited answer and persistence on reload. Bob cannot read Alice's conversation. Disable both optional
paths to compare the simple planner. Lesson includes exact acceptance and live comparison commands.

**Remaining limitations:** Native Claude delegation, actual nested billing/usage, live research
provider and browser visual interaction were not executed here. Missing live credentials/model
configuration: after securely supplying ANTHROPIC_API_KEY, verified AGENT_MODEL_ID and isolated
AGENT_WORKSPACE_DIR, set RUN_LIVE_RESEARCH_COMPARE=true and run
`npm run test -w @portfolio-pilot/agent -- test/research-comparison.live.test.ts`.
The test records aggregate/main usage and latency, checks two completed delegations and that nested
tokens increase aggregate usage. Reviewed live stdio scripts must implement their dedicated-token
auth and are trusted code, not an OS sandbox. No remote HTTP/SSE/OAuth transport is enabled.
Usage is per-run telemetry, not durable daily reservations (milestone 26); execution still resides
in the API process (27), sessions are host-local (28), production fixture packaging awaits 33.

## Previous milestone report — 22

**What works:** Research & alerts at `/research` and news-detail cards show affected holdings,
research actions, safe cited evidence, source timestamps, caveats, as-of and expandable explanations.
Owner-scoped save/unsave/dismiss/restore persists independently of evidence freshness. Open/saved/history
views include superseded and dismissed rows in history. Empty views explicitly explain that no relevant
news requires a research action; reading them does not invoke analysis.

AlertRule/AlertNotification models and authenticated CRUD support news categories, watched/currently
held securities, enabled state, inclusive exact-decimal concentration/relevance thresholds and cooldowns.
The outbox worker derives the owner only from a persisted private news event, rechecks current interests,
reuses shared public analysis, stores private recommendations and evaluates rules before acknowledgement.
PostgreSQL locks serialize concurrent evaluation and edits. Notification uniqueness includes owner,
rule revision, article and accepted content revision. Cooldown suppression is durable and cannot turn
visible on replay; rule edits retain cooldowns and deletion retains visible notification history.
Only a new recommendation identity emits creation. Recalculation preserves save/dismiss state.

Notification insertion/dismissal and recommendation mutations append sanitized owner-only
`research.updated` events in the same transaction. SSE carries identity/change only, UUID dedupe
absorbs repeated delivery, and reconnect/reset invalidates authoritative private reads. No email,
third-party messages, trades or agent-driven rule edits were added. Policy: ADR 0015.

**Changed files:**

- Created: contracts `src/alerts.ts`, `test/alerts.test.ts`; domain `src/alerts.ts`,
  `src/alerts.test.ts`; DB `src/alert-service.ts`, migrations
  `20261009100000_recommendation_alerts` and `20261009110000_alert_constraint_names`;
  API `alerts/rules`, `alerts/rules/[id]`, `alerts/notifications`, `alerts/notifications/[id]`,
  `recommendations/[id]` route handlers and `lib/alerts.integration.test.ts`; web `src/alerts.tsx`,
  `e2e/alerts.spec.ts`; ADR 0015 and lesson 22.
- Modified: contracts exports/research/browser events; domain exports/evidence provider allowlist;
  DB schema/generated client, research service, repository capability and exports; API authorization
  and browser-event mapping; web app/research/cards/styles/stream manager and tests; worker
  runtime/dispatcher/development fixture/manifest; package lock, versions, ADR index and this state.
  Compiled artifacts refreshed. No files removed, instruction files or milestone plan overwritten,
  dependency versions upgraded, commit/push/deployment or cloud provisioning. No Git repository exists.

**Check results (2026-10-02):**

- `npm install --package-lock-only --ignore-scripts --offline --cache .npm-cache` and
  `npm install --ignore-scripts --offline --cache .npm-cache` passed, 0 vulnerabilities; restored
  copied workspace directories as usable workspace links. The npm shim initially failed NVM4306;
  all npm commands were actually invoked through `node` and the installed `npm-cli.js` at
  `C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0/node_modules/npm/bin/npm-cli.js`.
- `npm run typecheck` passed all workspaces; `npm run build` passed package, Vite, Next and worker
  builds. Existing Vite directive/large-chunk and three Next instrumentation Edge warnings remain.
- With `DATA_MODE=mock` and `ALERT_TEST_DATABASE_URL` on `portfolio_m22_verify`, `npm run test`
  passed **251 tests** (contracts 15, domain 29, config 7, providers 17, DB 12, agent 99,
  web 29, API 34, worker 9). **68 unrelated opt-in infrastructure tests skipped** (57 API, 11 worker).
- `npm run test -w @portfolio-pilot/api -- lib/alerts.integration.test.ts` passed **4/4** with real
  PostgreSQL and Redis: duplicate ingestion, concurrent/repeated evaluation, one stored visible
  notification per rule/event revision, creation-event dedupe, replay, durable dismissal/save/history,
  cooldown suppression and owner isolation. Exact boundaries/null exposure and malformed inputs have
  additional domain/contract tests.
- With `ALERT_E2E_DATABASE_URL`, `npm run test:browser -w @portfolio-pilot/web -- alerts.spec.ts
  --workers=1` passed **1/1** in Chrome. News injected while offline recovered exactly once on reconnect;
  save/dismiss/reload/history, expand/collapse, Bob isolation and 390px layout passed. Screenshot
  `apps/web/test-results/alerts-mobile.png` visually reviewed.
- `npm run check:browser-boundary` passed. Prisma generate and `migrate:deploy` passed: fresh dedicated
  database received the first 12 migrations, then migration 13 aligned new foreign-key/index names.
  `prisma migrate diff --config packages/db/prisma.config.ts --from-config-datasource --to-schema
  packages/db/prisma/schema.prisma --script` confirms no new alert-schema drift; only existing
  NewsRead update actions and the intentionally SQL-only recommendation GIN index remain. Diff SQL
  was not applied. Docker CLI access denied, but direct PostgreSQL/Redis connectivity worked.

**How to demonstrate it:** Exact setup, worker/injection commands, UI steps and automated acceptance
commands are in `docs/lessons/22-recommendation-cards-and-alerts.md`. Start `npm run dev`, run the
worker with `WORKER_ROLE=outbox`, sign in as Alice, watch NOVA, create its alert rule, and execute
`npm run news:inject -w @portfolio-pilot/worker -- lesson22 1` twice. Review **Research & alerts**,
dismiss/save, reload, and compare Bob. The retained test DB is `portfolio_m22_verify` on 5546;
Redis is on 6379. Verification dev processes were stopped (5173/3001 no longer listening).

**Remaining limitations:** Live Claude credentials are absent. Set server-only `ANTHROPIC_API_KEY`,
`AGENT_MODE=claude`, `AGENT_MODEL_ID`, `AGENT_WORKSPACE_DIR`; run `npm run dev` and the outbox worker
with a supported real article. Numeric comparisons are deterministic, categories depend on the analyzer.
Latest read bounds are 50 recommendations / 100 notifications; older rows remain durable. Alert
evaluation is news-triggered, not quote-triggered or retroactive after rule edits. Long live analysis
shares dispatcher leases/retry budgets and may require operator requeue of DEAD events; independent
durable agent execution remains milestone 27. Broader previous infrastructure suites were skipped.
Next: milestone 23 only.

## Previous milestone report — 21

**What works:** Shared `article-analysis-v1` classifications contain public article data only. Cache
keys include accepted article revision, prompt/schema versions and model configuration. Concurrent and
duplicate delivery requests reuse one PostgreSQL analysis; leases renew during bounded runs and UUID
tokens fence completion. Invalid sources/URLs/symbols and prohibited target-price/trade/probability
text fail validation; failures back off for ten minutes. Accepted observation providers are checked
even when the canonical record originally came from an allowed provider.

Authorized holdings are combined afterwards using exact decimal market-value or consistent cost-basis
weights. Private `PortfolioImpact` and `Recommendation` rows persist rationale, evidence, affected
holdings/securities, uncertainties, counterarguments, UTC as-of times and versioned provenance. Four
research step types are available; neutral immaterial news can suggest no action. Opposing reporting
uses already-analyzed related evidence without extra model fan-out. Sentiment is neither a forecast
nor a calibrated probability. There is no trade operation.

Corrections invalidate citing recommendations in the ingestion transaction; reads also check current
revisions, full immutable ledger/portfolio metadata/watchlist fingerprints and configuration versions.
Sell/rebuy trades with unchanged net quantity invalidate correctly. Explicit recalculation refreshes
private snapshots and supersedes old recommendations. Evidence is visibly current, corrected, aged
(72 hours) or unavailable. Full policy: `docs/decisions/0014-shared-analysis-private-research.md`.
GET/POST `/api/news/:id/impact` and GET `/api/recommendations` enforce the session owner and no-store.
News detail renders research with safe citations and recalculation; SSE/recovery refresh private reads.

**Changed files (milestone slice, including work already present when this continuation started):**

- Created: `packages/contracts/src/research.ts`; domain `src/exposure.ts`, `exposure.test.ts`,
  `research.ts`, `research.test.ts`; DB `src/research-service.ts` and migration
  `20261008100000_research_recommendations`; agent `src/article-analysis.ts`,
  `test/article-analysis.test.ts` and `test/fixtures/research/*`; API `lib/research.ts`,
  `lib/research.integration.test.ts`, `app/api/news/[id]/impact/route.ts`,
  `app/api/recommendations/route.ts`; web `src/research.tsx`, `research.test.tsx`,
  `e2e/research.spec.ts`; ADR 0014 and lesson 21.
- Modified: contracts/domain/DB exports, DB Prisma schema and generated client, DB ingestion,
  agent `src/index.ts`, API authorization, web news/styles and stream manager/tests, ADR index,
  this state. Compiled package/web/API artifacts refreshed. No dependency or lockfile changes;
  instructions and project plan preserved. Workspace is not a Git repository.

**Check results:**

- `npm run typecheck` passed all workspaces. `DATA_MODE=mock; npm run test` passed **242 tests**:
  contracts 13, domain 27, config 7, providers 17, DB 12, agent 99, web 28, API 30, worker 9.
  **68 opt-in infrastructure tests skipped** in that command (57 API, 11 worker).
- With `RESEARCH_TEST_DATABASE_URL`, `npm exec --workspace @portfolio-pilot/api -- vitest run
  lib/research.integration.test.ts` passed **11/11** on real PostgreSQL. Covers three-owner
  relevance/exposure, shared/private isolation, duplicate deliveries, corrections, ledger/metadata
  changes, contradictory/neutral fixtures, source rejection/backoff, aged evidence, HTTP authorization,
  configuration invalidation and independent local caches competing through the PostgreSQL claim.
- `npm run migrate:deploy --workspace @portfolio-pilot/db` applied **all 11 migrations from empty**
  on new local database `portfolio_m21_schema_20261002`; `portfolio_m21_verify` was already at head.
- `npm run build` passed all workspaces with the existing Vite directive and three Next Edge warnings.
  `npm run check:browser-boundary` passed. Final UI wording was rechecked with
  `npm run test --workspace @portfolio-pilot/web` (28/28) and
  `npm run build --workspace @portfolio-pilot/web` (passed); final full typecheck also passed.
- With `RESEARCH_E2E_DATABASE_URL` and real local mock servers, `npm exec --workspace
  @portfolio-pilot/web -- playwright test e2e/research.spec.ts --workers=1` passed **1/1 in Chrome**.
  Checks news-detail generation/reload persistence, aged evidence/caveats, decimal basis labels,
  protected links, 390px layout and Bob's GET/POST 404s. Screenshot: `apps/web/test-results/research-mobile.png`.
- Earlier test runs: a new freshness assertion failed because it expected unrelated evidence to be
  corrected too; corrected to inspect the changed article. Chrome initially checked Bob before
  sign-in finished (401); now waits for his authenticated session. Neither failed run counted as a pass.
- Sandbox npm execution was denied by its installation trust check; approved execution outside the
  sandbox worked. Node 24.21.0/npm 11.19.0 active, local Docker reachable outside sandbox.
  Verification dev servers were stopped; ports 3001 and 5173 have no remaining listeners.

**How to demonstrate it:** exact PowerShell setup and verification commands are in
`docs/lessons/21-portfolio-impact-and-research-recommendations.md`. Run migrations/seed and `npm run dev`
with mock/demo settings; open `/news` as Alice, open an article and press **Analyze impact**. Seeded
neutral reporting may suggest no action. The Chrome acceptance test creates a material fixture, checks
three research step types, persistence and Bob isolation, then cleans up its own data.

**Remaining limitations:** Live Claude latency/cost/structured adherence is unverified: server-only
credentials are absent. Set `ANTHROPIC_API_KEY`, `AGENT_MODE=claude`, `AGENT_MODEL_ID` and
`AGENT_WORKSPACE_DIR`, then run `npm run dev` and **Analyze impact** on a supported material article.
The mock uses keyword rules; source validation does not establish factual truth. Opposite tone means
compare reports, not a proven factual contradiction. Quote values remain as-of snapshots until explicit
recalculation. Related analysis is cache-only. In-flight work can stop with the API; PostgreSQL leases
permit later retry, while durable execution remains milestone 27. Broader old infrastructure suites
were not rerun this slice. Local verification databases are retained; no cloud resources, trade execution,
commit, push or deployment. Next: milestone 22 only.

## Previous milestone report — 20

**What works:**

- **Sessions, kept separate from chat history.** Every owner-scoped conversation can be bound to its
  SDK session in a new `ConversationSession` row. The row holds:
  - SDK session ID and agent mode
  - host key: a hash of the host name and session-workspace realpath, or a per-process key for the
    mock
  - instruction version and model key
  - compare-and-set `generation` and the last run

  `ChatMessage` remains the complete application history. The binding is only a pointer to SDK
  transcript files, which exist on one host.
- **Live adapter.** It uses the documented session options, verified in installed `sdk.d.ts` 0.3.276
  and the official Sessions page:
  - `persistSession: true`, so transcripts are written only under `AGENT_WORKSPACE_DIR`, which is
    both `CLAUDE_CONFIG_DIR` and `cwd`
  - `resume: <recorded id>`, and never `continue`, which picks the directory's latest session
  - `session_id` captured from `system/init` and `result`
- **Session resolution (`resolveSession`).** A turn resumes only when all of these hold: the model and
  instruction version match, the host key matches, and the documented transcript
  `projects/*/<uuid>.jsonl` exists and is non-empty. Otherwise the turn is **reseeded**: a new
  session is seeded from an authorized summary, with a reason of `not_recorded`,
  `configuration_changed`, `not_local` or `session_missing`.
- **Resume failure.** A resume that fails before any visible output raises `SessionResumeError`. The
  turn then runs once in a seeded new session with reason `resume_failed`.
- **The authorized summary.** The server builds it from the owner's completed messages and their
  validated sources: eight turns clipped to 1,000 characters, an omitted-turn count, up to ten cited
  sources, and a note that it is "not a transcript". Resumed turns do not resend history.
- **Continuity in the UI.** Every assistant message persists `continuity { disposition, reason }`.
  The UI shows "Continued in the same assistant session", "New assistant session", or a highlighted
  note explaining that a new session saw only a summary, and why.
- **Instruction `portfolio-research-v2`.** It keeps every v1 rule and adds continuity and
  structured-analysis rules. One prompt serves both run kinds, because a resumed session keeps its
  original system prompt.
- **Serialization.** Overlapping turns in a conversation are deliberately rejected with 409 (the
  coordinator slot plus the one-running-run index), not queued. The binding changes only by
  compare-and-set, so a stale writer cannot replace a newer session.
- **UI.** The Assistant now has:
  - a follow-up composer ("Ask a follow-up in this conversation")
  - suggested follow-ups for cited sources
  - **Analyze news**
  - **Start a new conversation with the same scope**, which always starts a new session

  The mock adapter has bounded, process-local sessions that remember only cited article IDs. It
  honours the same resume contract, so an API restart behaves like a missing live session. It
  resolves "the first/second cited article" from the session or from the seed.
- **Structured analysis.** The Zod contract `news-analysis-v1` contains:
  - article references
  - event categories
  - affected securities (`held`, `watchlisted` or `mentioned`)
  - factual summary
  - interpretations with `low` or `medium` confidence only
  - at least one uncertainty
  - as-of time
  - evidence links

  The live adapter passes it as the documented `outputFormat` (draft-07 via `z.toJSONSchema`) and
  suppresses unvalidated prose. It returns `structured_output` raw and maps
  `error_max_structured_output_retries` and success-without-output to typed codes, including when
  the iterator throws after the error result.
- **Server-side validation (`validateNewsAnalysis`).** It never casts or parses strings. It runs, in
  order:
  1. Zod checks, plus as-of sanity: not in the future, and not before any cited article.
  2. Unknown sources: every article ID must have been read with `getNewsArticle` **in this run**.
     URLs and publication times must equal the tool's values, and securities must be linked to the
     cited article with the tool's relation.
  3. Missing references: claims must cite listed articles that have evidence links.

  On failure there is one retry in the same session, with a correction that names only paths and
  rule codes. Then the run fails with `analysis_invalid_structure`, `analysis_missing_references` or
  `analysis_unknown_source`. Failed runs persist a fixed message and no analysis. Valid analyses are
  stored as JSON, list exactly their validated articles as sources, and are rendered
  deterministically.
- **Acceptance.** A follow-up works in one session. Structured output cannot introduce nonexistent
  source IDs. Cross-pod persistence is explicitly deferred to milestone 28.

**Changed files:**

- **Created:**
  - `packages/contracts/src/news-analysis.ts` and `test/news-analysis.test.ts`
  - migration `20261007100000_resumable_sessions`
  - `packages/agent/src/sessions.ts`, `src/analysis.ts`, `src/instructions/portfolio-research-v2.ts`
    and `test/sessions-analysis.test.ts`
  - `test/fixtures/analysis/`: `valid`, `invalid-structure`, `missing-references`, `unknown-source`
    and a README
  - SDK fixtures `resumed-follow-up`, `session-resume-failed` (assumed shape), `structured-output`
    and `structured-retries-exhausted`
  - `apps/api/lib/conversation-sessions.test.ts` and `conversation-sessions.integration.test.ts`
  - `apps/web/src/chat-analysis.test.tsx`
  - ADR `0013-resumable-sessions-structured-analysis.md` and
    `docs/lessons/20-resumable-conversations-and-structured-analysis.md`
- **Modified:**
  - contracts: `chat.ts` (run kind, continuity, message `kind`/`analysis`/`continuity`),
    `agent-events.ts` (run `kind`), `index.ts`
  - db: `prisma/schema.prisma`, `src/chat-service.ts` (binding read/CAS, kind/analysis/continuity/
    attempts), `src/index.ts`; generated client refreshed
  - agent: `src/index.ts`, `src/streaming.ts`, `src/research-context.ts`,
    `src/mock-portfolio-agent.ts`; the tests `streaming`, `agent`, `sdk-registration` and
    `research-context`; `fixtures/sdk/README.md`
  - api: `lib/chat.ts` (session resolution, resume fallback, binding, bounded analysis retry)
  - web: `src/chat.tsx`, `src/styles.css`, `src/lib/agent-runs.test.ts`; `e2e/chat.spec.ts` (two new
    tests, plus an exact `New conversation` locator); `e2e/shell.spec.ts` (exact locator)
  - ADR index; dated notes appended to ADRs 0011 and 0012; this state
- **Unchanged:** no dependency versions or lockfile; `portfolio-research-v1.ts` is kept as the base
  of v2. Not a Git repository; no commit, push or deployment.

**Check results:**

- **Install, typecheck, build:** `npm ci --ignore-scripts --offline --cache .npm-cache` installed
  with 0 vulnerabilities. `npm run typecheck` passed every workspace. `npm run build` passed, with
  only the existing Vite `use client` and three Next instrumentation Edge warnings.
  `npm run check:browser-boundary` passed.
- **Unit tests:** with `DATA_MODE=mock`, `npm run test` passed **216 tests**, with **57 opt-in
  infrastructure tests skipped** (46 API, 11 worker):

  | Workspace | Passed | New |
  | --- | --- | --- |
  | contracts | 13 | 3 |
  | domain | 14 | — |
  | config | 7 | — |
  | providers | 17 | — |
  | DB | 12 | — |
  | agent | 90 | 23 |
  | web | 24 | 2 |
  | API | 30 | 3 |
  | worker | 9 | — |

  Four existing expectations changed intentionally: `persistSession` false → true, the result's
  `sessionId`, and the v2 instruction and prompt signature.
- **Acceptance (real PostgreSQL):** the new disposable `portfolio_m20_verify` database (port 5546)
  was migrated from empty with all ten migrations. With `SESSION_TEST_DATABASE_URL`,
  `lib/conversation-sessions.integration.test.ts` passed **10/10 on two consecutive runs**. It
  covers:
  - a follow-up resumed in the same session, with the binding at generation 2 and history separate
  - a missing session reseeded from the summary
  - `not_local` and `configuration_changed`
  - an SDK resume rejection falling back once (attempts 2, with the seed contents checked)
  - a mock analysis persisted with validated sources
  - a **nonexistent source ID** rejected after the bounded retry in the same session
    (`analysis_unknown_source`, attempts 2, no analysis stored, correction without the invented ID)
  - invalid structure corrected on retry
  - missing references failing with its typed code
  - an overlapping turn rejected with 409 while the binding stays unchanged
  - owner-scoped and compare-and-set binding writes, including Bob denied
- **Regressions:** each database below was migrated to head before its suite ran.

  | Suite | Database / Redis | Result |
  | --- | --- | --- |
  | Milestone 19 chat, run-events, coordinator and session unit suites | `portfolio_m19_verify`, Redis DB 11 | 17/17 |
  | SSE, agent tools, events | `portfolio_m14_verify`, Redis DB 12 | 16/16 |
  | Portfolio, auth | `portfolio_m08_verify`, `portfolio_m07_auth_verify` | 19/19 |
  | Worker | `portfolio_m12_verify`, `portfolio_m13_verify`, `portfolio_m16_verify`, Redis DB 14 | 20/20 |

  A first worker run that pointed all three worker suites at one database failed 1 outbox test: it
  claimed another suite's system event. That was a test-isolation mistake in the invocation, not a
  code fault, and was not used as evidence.
- **Chrome:** dev servers ran on `portfolio_m19_verify` (Redis DB 13,
  `AGENT_MOCK_STREAM_DELAY_MS=80`).
  - `chat.spec.ts` passed **15/15** (`--repeat-each=3 --workers=1`). It includes the new follow-up
    test (continued-session note, re-read cited link, binding generation 2) and the Analyze news
    test (all sections, validated link, held relation, no horizontal scroll at 390 px, and a new
    conversation with the same scope that has no binding).
  - `streaming.spec.ts` + `shell.spec.ts` passed **9/9**, and `shell.spec.ts` passed 6/6 when
    repeated.
  - The first repeated run failed 5 tests. The setup locator `New conversation` (not exact) also
    matched the new "Start a new conversation with the same scope" button once a conversation was
    selected. Both specs now use exact names.
  - The dev servers were stopped and the ports released.

**How to demonstrate it:** see `docs/lessons/20-resumable-conversations-and-structured-analysis.md`.
On `/assistant` as Alice:

1. Ask *"Which recent news affects my largest holding?"*.
2. Click **Tell me more about the first cited article** and **Send**. The answer shows *Continued in
   the same assistant session*.
3. Restart the API and ask again. The reseeded note appears.
4. Press **Analyze news**.
5. Use **Start a new conversation with the same scope**.

**Remaining limitations:**

- **No live Claude call:** there is no `ANTHROPIC_API_KEY`. Real `resume` behavior is unverified:
  latency, transcript location, and what the CLI emits for a missing session (the fixture is an
  assumed shape; detection relies only on "failed before output"). Live `outputFormat` adherence,
  retry counts and token cost are also unverified.
- **Next command:** set `AGENT_MODE=claude`, `AGENT_MODEL_ID`, `AGENT_WORKSPACE_DIR` and
  `ANTHROPIC_API_KEY`, restart the API, ask the acceptance question, then a follow-up, then
  **Analyze news**. Confirm a `projects/*/<id>.jsonl` file appears under the workspace.
- **Transcript storage:** SDK transcripts (including private tool results) now persist under
  `AGENT_WORKSPACE_DIR`, with no retention or cleanup yet. Keep it server-only.
- **Deferred to milestone 28:** cross-pod and restart persistence of SDK sessions (artifact store,
  Blob, lease-guarded restore, retention). Until then, a restart or another host means an honest
  reseed.
- **Single process (milestone 27):** overlapping turns are rejected, not queued.
- **Analysis scope:** an analysis may cite only articles re-read in the same run, so sources from
  earlier turns must be fetched again. The mock's event categories are keyword-based.
- **Prisma drift:** partial indexes and checks exist only in SQL, so `migrate deploy` is the
  supported path.
- **Retained databases:** `portfolio_m20_verify` is new. `m07_auth`, `m08`, `m12`, `m13`, `m14`,
  `m16` and `m19` were migrated to head.
- **Next:** milestone 21 only.

## Previous milestone report — 19

**What works:** A question now creates a run. `POST /api/conversations/:id/runs` admits it
(409 if the conversation or account is busy). It captures a signed SSE cursor **before** the run
exists, then inserts the user message and an `AgentRun(running)` in one transaction. It returns
`202 { run, userMessage, replayCursor }`; the answer streams in the background. Progress travels
over the existing authorized `/api/events` channel as typed application events.

- **Event types:** `agent.run.started`, `agent.text.delta` (with `blockId` and `offset`),
  `agent.block.completed`, `agent.tool.status` (six public tool names or `other`;
  started/running/succeeded/failed, never arguments or results), `agent.message.completed` (the
  persisted `ChatMessage`) and `agent.run.completed`.
- **IDs and ordering:** every event carries the run ID, the pre-allocated assistant message ID,
  application block and tool-call IDs, and a per-message `sequence` contiguous from 0. The event
  UUID is UUIDv5(run, sequence).
- **SDK mapping:** the live adapter passes the installed SDK's `includePartialMessages: true`
  (verified in `sdk.d.ts` 0.3.276). `SdkStreamMapper` maps the discriminated `stream_event`,
  `assistant`, `user` (tool results), `tool_progress` and `result` messages. Deltas build a draft.
  The completed assistant block is authoritative and is emitted once, replacing the draft.
  `result.result` is used only if no block streamed. Thinking, tool-input JSON, subagent frames,
  SDK IDs and error text never leave the server.
- **Publication:** `RunEventPublisher` publishes in order to the owner's Redis stream (not the
  outbox), batching deltas every 150 ms or 1,024 chars. A failed publish leaves a detectable gap.
  Agent events do not bump the owner's cache generation.
- **Exactly-once outcome:** `finishRun` is the only terminal transition. It is a conditional
  update in the same transaction as the assistant message insert, which reuses the event
  `messageId`. A partial unique index allows one running run per conversation.
- **Browser:** a pure reducer drops duplicates (lower sequence), marks gaps, applies deltas only
  at their exact offset, and replaces drafts with authoritative blocks and messages. The persisted
  message renders under the same ID, so the answer appears exactly once.
  `StreamManager.ensureReplay` reconnects from the pre-run cursor if a snapshot recovery replaced
  its cursor during the POST, or defers it to the pending recovery.
- **Recovery:** after a reconnect or reload, the page reads `GET …/runs/active`,
  `GET /api/runs/:id` and the messages list, and polls the active run as a fallback. Runs older
  than 120 s that no process holds become `failed/interrupted`.
- **Cancellation:** **Cancel answer** calls `POST /api/runs/:id/cancel` (owner-scoped,
  origin-checked, idempotent, 202). It records `cancelRequestedAt`, aborts the coordinator run
  with reason `cancelled`, and triggers the SDK `abortController`; every iterator read is raced
  against abort, `Query.close()` always runs, and the slot is released when the work settles. An
  orphan is finished directly. The request signal is never used, so a disconnect is not a
  cancellation. Cancelled answers persist a fixed message with status `cancelled`.
- **Mock adapter:** emits the same events (live tool status, word chunks paced by
  `AGENT_MOCK_STREAM_DELAY_MS`, default 25 ms, then one authoritative block).
- **Removed:** the synchronous `POST …/messages` path (now 405) and `chatTurnResultSchema`.

**Changed files:**

- **Created:**
  - `packages/contracts/src/agent-events.ts`
  - migration `20261006100000_streamed_agent_runs`
  - `packages/agent/src/errors.ts`, `streaming.ts`, `test/streaming.test.ts`, and
    `test/fixtures/sdk/` (six JSON fixtures + README)
  - `apps/api/lib/agent-run-events.ts` and its test
  - routes `apps/api/app/api/conversations/[conversationId]/runs/route.ts`, `runs/active/route.ts`,
    `apps/api/app/api/runs/[runId]/route.ts` and `[runId]/cancel/route.ts`
  - `apps/web/src/lib/agent-runs.ts` and its test
  - ADR `0012-streamed-agent-runs.md`; `docs/lessons/19-streamed-agent-answers.md`
- **Modified:**
  - contracts: `index.ts` (agent `AppEvent` types), `chat.ts` (`cancelled` status,
    `Conversation` type), `browser-events.ts` (placeholder agent events replaced), `test/events.test.ts`
  - db: `prisma/schema.prisma` (`AgentRun`), `src/chat-service.ts` (run lifecycle), `src/cache.ts`
    (skip agent events), `src/index.ts`
  - `packages/config/src/server.ts` (`AGENT_MOCK_STREAM_DELAY_MS`)
  - agent: `src/index.ts` (streaming live adapter), `src/mock-portfolio-agent.ts`
  - api: `lib/chat.ts` (run service), `lib/chat-coordinator.ts` (admit/launch/cancel) and its test,
    `lib/browser-event.ts`, `lib/events.test.ts`, `lib/chat.integration.test.ts` (rewritten for
    runs), `app/api/conversations/[conversationId]/messages/route.ts` (GET only)
  - web: `src/lib/stream-manager.ts`, `src/streaming.tsx`, `src/chat.tsx`, `src/styles.css`,
    `e2e/chat.spec.ts`
  - ADR index and this state
- **Unchanged:** no dependency versions or lockfile. Build outputs and Next route types were
  refreshed. Not a Git repository; no commit, push or deployment.

**Check results:**

- **Install, typecheck, build:** `npm ci --ignore-scripts --offline --cache .npm-cache` installed
  348 packages with 0 vulnerabilities. `npm run typecheck` passed every workspace. `npm run build`
  passed with only the existing Vite `use client` and three Next instrumentation Edge warnings;
  the four new routes compiled. `npm run check:browser-boundary` passed.
- **Unit tests:** with `DATA_MODE=mock`, `npm run test` passed **185 tests** with **47 opt-in
  infrastructure tests skipped** (36 API, 11 worker): contracts 10, domain 14, config 7,
  providers 17, DB 12, agent 67 (13 new streaming/fixture/cancel tests), web 22 (9 new), API 27,
  worker 9.
- **Acceptance (real PostgreSQL + Redis):** the new disposable `portfolio_m19_verify` database
  (port 5546) was migrated from empty with all nine migrations. With `CHAT_TEST_DATABASE_URL` and
  `CHAT_TEST_REDIS_URL=redis://127.0.0.1:6379/11`, `lib/chat.integration.test.ts` passed **8/8**
  against the real route handlers, Redis and the real SSE endpoint. It covers:
  - rejection of anonymous, forged-origin, injected-owner, foreign and oversized requests
  - partial plus final delivered exactly once, replayed from the pre-run cursor after a
    zero-delay run had already finished
  - UUID dedupe of republished events over SSE
  - the four recorded fixtures through the live adapter
  - sanitized SDK and configuration failures
  - disconnect not cancelling, plus explicit cancel with `close()` and slot release
  - coordinator and database single-run admission, interrupted-run recovery and orphan cancel
  - foreign 404s
- **Fixes during development:** the agent tests exposed a chunk-size off-by-one and a hang when
  an iterator ignores abort; both were fixed in code. Other first failures were test mistakes
  (BigInt in `JSON.stringify`, microtask start, split limits).
- **Regressions:**
  - SSE + agent tools + events API suites passed **16/16**, after migrating `portfolio_m14_verify`
    to head (Redis DB 12).
  - The worker suite with outbox, news and ingestion URLs passed **20/20** with none skipped.
- **Chrome:** against dev servers on `portfolio_m19_verify` (Redis DB 13,
  `AGENT_MOCK_STREAM_DELAY_MS=80`), `chat.spec.ts` passed **9/9** (`--repeat-each=3 --workers=1`).
  It covers the streamed draft with tool progress, the cited answer exactly once, reload, a
  390 px layout, Bob's 404s and the 405 on the old POST, Cancel → cancelled, and reload mid-answer
  still completing. `streaming.spec.ts` + `shell.spec.ts` passed **9/9**. The dev servers were
  stopped afterwards.

**How to demonstrate it:** see `docs/lessons/19-streamed-agent-answers.md`. Create and migrate
`portfolio_m19_verify`, then start `npm run dev` with:

- `DATA_MODE=mock`, `AGENT_MODE=mock`, `AGENT_MOCK_STREAM_DELAY_MS=80`
- `REDIS_URL=redis://127.0.0.1:6379/13`
- `DEMO_AUTH_ENABLED=true`, `AUTH_BASE_URL=http://127.0.0.1:5173`, `AUTH_SECRET`

Then sign in as Alice on `/assistant` and ask *"Which recent news affects my largest holding?"*.
Watch the tool progress and draft, then the single final answer. Try **Cancel answer**, and
reload mid-answer. Automated commands are listed in the lesson.

**Remaining limitations:**

- **No live Claude call:** there is no `ANTHROPIC_API_KEY`. Real partial-message cadence,
  block/`message.id` matching on live data, `tool_progress` frequency and abort latency are
  unverified.
- **Fixtures:** the SDK fixtures were authored from the installed type definitions, not captured
  live.
- **Next command:** set `AGENT_MODE=claude`, `AGENT_MODEL_ID`, `AGENT_WORKSPACE_DIR` and
  `ANTHROPIC_API_KEY`, restart the API, ask the acceptance question, and cancel a second run.
- **Single process:** do not run API replicas. In-flight runs become *interrupted* after 120 s
  following a restart (milestone 27).
- **Without Redis:** runs still work, but progress appears only through 2–5 s polling of the run.
- **Missed draft text:** it is not re-sent; the UI shows an incomplete-draft notice until the
  authoritative block or message arrives.
- **Cancellation:** no partial text is kept. Approvals and richer cancellation are milestone 25.
- **Prisma drift:** the partial unique index exists only in SQL, so `prisma migrate dev` may report
  drift. `migrate deploy` is the supported path.
- **Retained databases:** `portfolio_m19_verify` and the updated `portfolio_m14_verify` were kept.
- **Next:** milestone 20 only.

## Previous milestone report — 18

**What works:** The Assistant page now runs authenticated, portfolio-aware chat, replacing the milestone 04 demo Q&A. `Conversation` and `ChatMessage` are persisted in PostgreSQL (migration `20261005100000_grounded_chat`, with role/status check constraints and cascade deletes). `chatService(db, owner)` scopes every query by the session-derived owner. Owner-scoped routes: `GET/POST /api/conversations`, `GET /api/conversations/:id` and `GET/POST /api/conversations/:id/messages`. Conversations use keyset pages by ID anchor; messages are newest-first pages by monotonic sequence, returned chronologically. Foreign IDs, foreign pagination anchors, foreign portfolio scopes, injected `ownerId`/`userId`, oversized bodies (> 10 kB, chunked included) and messages over 2,000 characters are rejected; foreign and missing records both return 404. The POST re-checks the session before returning private text, and responses are `no-store`. `buildResearchPrompt` builds context only from owner-bound inputs: the verified portfolio scope re-read through tools, at most eight completed history messages clipped to 2,000 characters, a UTC as-of time (recent = 7 days) and, for "largest" questions, an authorized holdings ranking. That ranking uses the new pure domain `largestHolding` (exact decimals, aggregated by security, withheld for missing/stale valuation or truncated/over-budget paging, ties flagged). All of it is JSON-encoded as untrusted data. The versioned `portfolio-research-v1` instruction is passed as the SDK `systemPrompt` and stored on every assistant message. It covers tool-based calculation explanations, citing tool-supplied article IDs/URLs, Facts vs Interpretation, missing/stale/synthetic evidence, clarification for unresolved scope, no return promises, no trades, and no secrets, reasoning, transcripts or tool arguments. `researchContext` records sources only from successful `getNewsArticle` results with validated HTTP(S), credential-free URLs (≤ 30). React renders a small escaped Markdown subset, and links become anchors only when they match that message's source registry. The replaceable `RunCoordinator` has a process-local `LocalRunCoordinator` (4 global / 2 per account / 1 per conversation, 409 instead of queuing, 90 s watchdog abort that keeps the slot until work settles, browser disconnect does not cancel); it is documented as single-process until milestone 27. Failures persist a fixed sanitized assistant message. `POST /api/demo/ask`, its DTOs and the unused general-Q&A adapters are removed. Acceptance: "Which recent news affects my largest holding?" invokes authorized summary/holdings/news/article tools and returns the largest holding's exact USD value with cited article links. Bob cannot read, write or paginate Alice's conversation.

**Changed files:** Created `packages/contracts/src/chat.ts`; `packages/db/src/chat-service.ts` and migration `20261005100000_grounded_chat`; `packages/domain/src/largest-holding.ts` and its test; `packages/agent/src/instructions/portfolio-research-v1.ts`, `research-context.ts`, `test/research-context.test.ts`; `apps/api/app/api/conversations/route.ts`, `[conversationId]/route.ts`, `[conversationId]/messages/route.ts`; `apps/api/lib/chat.ts`, `chat-coordinator.ts`, `chat-coordinator.test.ts`, `chat.integration.test.ts`; `apps/web/src/chat.tsx`, `chat-markdown.tsx`, `chat-markdown.test.tsx`, `apps/web/e2e/chat.spec.ts`; ADR `0011-grounded-chat-local-coordination.md`; `docs/lessons/18-grounded-portfolio-chat.md`. Modified `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/contracts/src/index.ts`, `packages/domain/src/index.ts`, `packages/agent/src/index.ts` (demo adapters removed; system prompt wired), `mock-portfolio-agent.ts`, `tools/context.ts`, `tools/portfolio-tools.ts`, agent tests, `apps/api/lib/authorization.ts`, `agent-tools.ts`, existing API tests, `apps/web/src/app.tsx`, `styles.css`, `e2e/shell.spec.ts`, ADR index and this state. Removed `apps/api/app/api/demo/ask/` (route, test and directory). No dependency versions or lockfile changed. Build outputs and Next.js generated types refreshed. This directory is still outside Git; no commit, push or deployment.

**Check results:** `npm run typecheck` passed every workspace. With `DATA_MODE=mock`, `npm run test` passed **157 tests**, with **45 opt-in infrastructure tests skipped** (34 API, 11 worker): contracts 8, domain 14, config 7, providers 17, DB 12, agent 54, web 13, API 23, worker 9. `npm run build` passed every workspace with only the existing Vite `use client` and three Next instrumentation Edge warnings. `npm run check:browser-boundary` passed. A new disposable `portfolio_m18_verify` database (port 5546) was migrated from empty (all eight migrations). With `CHAT_TEST_DATABASE_URL`, `lib/chat.integration.test.ts` and `lib/chat-coordinator.test.ts` passed **8/8** against real PostgreSQL and the actual route handlers. That covers anonymous/forged-origin/injected-owner rejection, the acceptance question with cited evidence and no unrelated article, foreign 404s, pagination without duplicates, body bounds, and a sanitized failure without configuration leakage. Milestone 17 regression `lib/agent-tools.integration.test.ts` passed **7/7** on the same database. Chrome: with `CHAT_E2E_DATABASE_URL`, `chat.spec.ts` + `shell.spec.ts` passed **12/12** across `--repeat-each=3 --workers=1`. That covers the browser acceptance journey, persisted citations after reload, a 390 px layout without horizontal scroll, Bob's 404s and the 404 for the removed demo endpoint. The first browser runs exposed a real UI race. Creating a conversation selected its ID before the list contained it, and an older composer stayed mounted while creation was in flight. Now the list refreshes before selection, and the composer is replaced by a status while creating. Tests now wait for the created ID from the POST response. A pre-existing shell test race (selecting `Portfolio` before navigation from News completed) now waits for the Portfolios heading and uses the exact label. Parallel repeated runs against the one shared database still interfere and were not used as evidence. Dev servers already running on 5173/3001 (pointing at `portfolio_m18_verify`) were used for browser checks and left running.

**How to demonstrate it:** See `docs/lessons/18-grounded-portfolio-chat.md`. Create/migrate/seed `portfolio_m18_verify`, run the API with `DATA_MODE=mock`, `AGENT_MODE=mock` and `DEMO_AUTH_ENABLED=true`, then `npm run dev`. Open `/assistant` as Alice, create a conversation and ask "Which recent news affects my largest holding?". Then sign in as Bob and confirm the conversation is absent and its URLs return 404. Automated: `npm exec --workspace=@portfolio-pilot/api -- vitest run lib/chat.integration.test.ts lib/chat-coordinator.test.ts` with `CHAT_TEST_DATABASE_URL`, and `npm run test:browser --workspace=@portfolio-pilot/web -- chat.spec.ts shell.spec.ts --workers=1` with `CHAT_E2E_DATABASE_URL`.

**Remaining limitations:** No live Claude call was made (no `ANTHROPIC_API_KEY`), so real model tool selection, instruction adherence, citation quality and budget sufficiency (6 turns, USD 0.10, 60 s) are unverified. Next command: set `AGENT_MODE=claude`, `AGENT_MODEL_ID`, `AGENT_WORKSPACE_DIR` and `ANTHROPIC_API_KEY`, restart the API, and ask the acceptance question in `/assistant`. The coordinator is single-process: do not run multiple API replicas; in-flight turns are lost on restart and can leave a user message without a reply. There is no streaming, SDK session resume, request idempotency or explicit cancellation (milestones 19, 20, 25, 27). The mock agent is a deterministic keyword planner. The source registry proves retrieval provenance, not claim truth; structured claim validation is milestone 20. Live history is passed as bounded data to a fresh SDK session. The remaining browser specs (news, streaming, portfolio, providers) were not rerun because their code did not change. Browser tests that share one database should run with `--workers=1`. `portfolio_m18_verify` was retained for demonstration. Next work is milestone 19 only.

## Previous milestone report — 17

**What works:** `packages/agent` registers six read-only tools with the installed SDK's `tool()`/`createSdkMcpServer()` (verified in `sdk.d.ts` 0.3.276 and the official custom-tools/tool-search docs): `getPortfolioSummary`, `listHoldings`, `listTransactions`, `getQuotes`, `searchNews`, `getNewsArticle`. A fresh in-process server named `portfolio` is built per run from a trusted context: an owner-bound data port, server DATA_MODE and a clock. The port is `agentToolReads(db, cache, owner)` in `packages/db`, composed in `apps/api/lib/agent-tools.ts` from the opaque `AuthenticatedOwner` minted from the session cookie. No schema accepts a user. Over the SDK path an extra `userId` is stripped (proved over the MCP protocol), and direct invocations reject it via strict re-validation. Repositories enforce ownership in SQL; foreign and nonexistent IDs return the same `NOT_FOUND`, and quotes are limited to securities the owner traded or watches. Money comes only from domain functions: `calculatePortfolioSummary` and the new `combinePortfolioTotals`, `valuationCoverage` and `classifyQuote`. Valuation now shares the latter, with unchanged behavior. Inputs are Zod-bounded (20 portfolios, 50 holdings/transactions, 25 quotes, 10 articles), text is clipped, and results are capped at 48,000 bytes with honest paging. Each result carries sources, calculation, data mode, UTC generation time, freshness status/policy/timestamps, page, truncation, an untrusted-news flag and notes. Failures return fixed `INVALID_ARGUMENT`/`NOT_FOUND`/retryable `UNAVAILABLE` messages with no raw exception text. A new owner-scoped `newsReads.search` (text/ticker/portfolio/watchlist, keyset pages) backs `searchNews`. `portfolioToolQueryOptions` sets `tools: []`, bare-name built-in `disallowedTools`, `mcpServers` with only `portfolio` plus `strictMcpConfig`, exactly six `allowedTools`, `permissionMode: 'dontAsk'`, a deny-by-default `canUseTool` requiring `source: 'sdk'`, and empty settings/skills/agents/plugins. `ClaudePortfolioAgentService` uses these options with tool search off. `MockPortfolioAgentService` invokes the same handlers deterministically and returns a sanitized tool trace.

**Changed files:** Created `packages/agent/src/tools/schemas.ts`, `context.ts`, `portfolio-tools.ts`, `options.ts`; `packages/agent/src/mock-portfolio-agent.ts`; `packages/agent/test/fixtures.ts`, `tools.test.ts`, `sdk-registration.test.ts`; `packages/domain/src/portfolio-facts.ts` and its test; `packages/db/src/agent-tool-reads.ts`; `apps/api/lib/agent-tools.ts` and `agent-tools.integration.test.ts`; ADR `docs/decisions/0010-authorized-agent-tools.md`; `docs/lessons/17-authorized-custom-tools.md`. Modified `packages/agent/src/index.ts` (shared live-run helper; existing `ClaudeAgentService` behavior and tests unchanged), `packages/agent/package.json` (contracts/domain, `zod` 4.6.5, dev `@modelcontextprotocol/sdk` 1.31.0 — already-installed versions), `package-lock.json` (metadata only), `packages/domain/src/decimal.ts` (`parseSigned`), `valuation.ts`, `index.ts`, `packages/contracts/src/index.ts` (`newsSearchQuerySchema` and type aliases), `packages/db/src/news-service.ts` (`search`), `packages/db/src/index.ts`, ADR index, `docs/versions.md` and this state. No migrations, routes, UI, instruction files or milestone plan changed; no files removed. Build outputs refreshed. This directory is still outside Git; no commit, push or deployment.

**Check results:** `npm ci --ignore-scripts --offline --cache .npm-cache` restored dependencies (0 vulnerabilities); after the manifest change `npm install --ignore-scripts --offline` changed no resolved versions. `npm run typecheck` passed every workspace. With `DATA_MODE=mock` and `AGENT_TOOLS_TEST_DATABASE_URL`, `npm run test` passed **158 tests**, with the same **32 opt-in infrastructure tests skipped** as milestone 16 (21 API, 11 worker): contracts 8, domain 13 (5 new), config 7, providers 17, DB 12, agent 48 (45 new), web 12, API 32 (7 new), worker 9. Agent tests cover: registration and JSON Schemas over a real MCP client/in-memory transport; protocol-level rejection of out-of-range arguments and unknown tools; `userId` stripping; SDK options and the permission guard; live-service option wiring through a fake `query`; valid requests; injected identity; foreign IDs; 23 malformed-input cases; large pages; multi-byte oversized news under the byte budget; stale/missing/future quotes; withheld valuation; sanitized provider failures; and mock-adapter parity. The new disposable `portfolio_m17_verify` database (port 5546) was migrated from empty (all seven migrations) and seeded. The 7 real-PostgreSQL acceptance tests passed on three consecutive runs and left zero fixture rows. Regression reruns: worker news acceptance 1/1 on m17; portfolio/summary/auth API acceptance **19/19** after applying the existing migrations to `portfolio_m08_verify`/`portfolio_m07_auth_verify` (that suite refuses other databases). `npm run build` passed every workspace with only the existing Vite directive and three Next instrumentation Edge warnings. `npm run check:browser-boundary` passed. Initial failures were test mistakes, corrected without weakening behavior: a hand-computed total (the domain's exact 1241.00 was right), a fake port that did not sort like the repository, and a schema regex that matched descriptions instead of property names. Browser tests were not rerun because no frontend or route code changed.

**How to demonstrate it:** See `docs/lessons/17-authorized-custom-tools.md`. Credential-free: `npm.cmd run test --workspace=@portfolio-pilot/agent -- --reporter=verbose`. Real repositories: create/migrate/seed a loopback `*_verify` database, set `DATA_MODE=mock` and `AGENT_TOOLS_TEST_DATABASE_URL`, then run `npm.cmd exec --workspace=@portfolio-pilot/api -- vitest run lib/agent-tools.integration.test.ts --reporter=verbose`. Alice's and Bob's tool calls and mock answers run against seeded and fixture data.

**Remaining limitations:** No live Claude call was made (no credentials). The tool-enabled live service and its configuration are verified only with a fake `query`; real tool selection, multi-turn behavior and budget sufficiency (6 turns, 0.10 USD default) are unverified until milestone 18 supplies `ANTHROPIC_API_KEY`, `AGENT_MODEL_ID` and `AGENT_WORKSPACE_DIR`. `/api/demo/ask` and the Assistant UI are unchanged (general Q&A; copy still says portfolio context is not connected); grounded chat is milestone 18. Through the SDK, unknown arguments are stripped rather than rejected (identity still cannot change). The JSON Schema the model sees does not forbid extra properties. `listTransactions` pages oldest first. Overview totals require each portfolio's summary (up to 20 owner-scoped reads per call). Text search uses PostgreSQL case-insensitive `contains` (ILIKE) without a trigram index, adequate for owner-filtered sets but not tuned for large corpora. Usage budgets, approvals, hooks, streaming of tool progress and durable runs are milestones 19–28. `portfolio_m17_verify` was retained (seeded) for demonstration. No required local check is blocked. Next work is milestone 18 only.

## Previous milestone report — 16

**What works:** The authenticated News page now shows persisted reporting filtered by all current interests, one owned active portfolio or watchlist. Current holdings match outbox fan-out (positive remaining stock quantity); archived and fully sold positions do not contribute. Articles include publisher/provider, UTC publication/provider/actual ingestion timestamps, exchange-aware securities, revision/read status and truthful synthetic/delay labels. Keyset pagination and ID dedupe avoid offset shifts and duplicate rows. Displayed articles remain stable while events reconcile authoritative queries; a reserved accessible live region and explicit Show updates action stage arrivals, removals and corrections, including notifications for older pages. Loaded page queries cannot silently append on SSE. Detail dialogs support Escape/focus restoration and provide safe canonical links, bounded immutable provenance with accepted observation marked, and deterministic related holdings/decimal valuation/allocation with quote freshness. Text is bounded and rendered inert through React, without HTML/Markdown interpretation. Per-owner read receipts persist in PostgreSQL and preserve the revision read; corrections become unread. Canonical merges retain read records and correction fan-out includes previous and current audiences. The accepted observation pointer prevents stale/equal-timestamp lower revisions from supplying displayed provenance. Provider samples moved to Settings, clearly labeled separately. The dev-only fixture CLI validates development/mock/loopback before connecting and invokes the real provider/leased worker ingestion path; no injection HTTP endpoint exists.

**Changed files:** Created `apps/web/src/news.tsx`, `apps/web/src/lib/news-content.ts`, `news-content.test.ts`, `apps/web/e2e/news.spec.ts`, `news-live.spec.ts`; `packages/db/src/news-service.ts`; migrations `20261004100000_news_reads` and `20261004103000_accepted_news_observation`; authenticated `apps/api/app/api/news/[id]/route.ts` and `[id]/read/route.ts`; `apps/worker/src/fixture.ts`, `inject-fixture.ts`, `test/fixture.test.ts`, `test/news.integration.test.ts`; `docs/lessons/16-live-news-experience.md` and ADR `0009-news-reading-and-correction-provenance.md`. Modified contracts, Prisma schema/generated client, ingestion, cached reads, worker package script/outbox cache-key acceptance, web app/market/stream manager/context/styles, existing streaming/provider/shell browser tests, readiness unit fixture configuration, ADR index and this state. Build outputs and generated Next.js types refreshed. No dependency versions, lockfile, instruction files or milestone plan changed; no files removed. This directory remains outside Git; no commit/push/deployment.

**Check results:** `npm.cmd ci --ignore-scripts --offline --cache .npm-cache` installed 348 packages, zero audit vulnerabilities. `npm.cmd run migrate:deploy --workspace=@portfolio-pilot/db` passed all seven migrations from an empty `portfolio_m16_migrations_verify` database, and the acceptance database was migrated and seeded successfully. `npm.cmd run typecheck` passed all workspaces after stopping dev and regenerating route types with `npm.cmd exec --workspace=@portfolio-pilot/api -- next typegen`. `npm.cmd run test` passed **101 tests**, with **32 explicitly opt-in infrastructure tests skipped** (21 API and 11 worker) and no observability test files. Separately, `NEWS_TEST_DATABASE_URL`, `INGESTION_TEST_DATABASE_URL`, `OUTBOX_TEST_DATABASE_URL` and `OUTBOX_TEST_REDIS_URL` enabled `npm.cmd run test --workspace=@portfolio-pilot/worker -- --maxWorkers=1`: **20/20 passed, none skipped**, covering real PostgreSQL/Redis ingestion, outbox, streams, cache, pagination, read state, foreign access, accepted correction provenance and stale equal-timestamp rejection. `NEWS_E2E=true npm.cmd run test:browser --workspace=@portfolio-pilot/web -- news-live.spec.ts news.spec.ts streaming.spec.ts shell.spec.ts providers.spec.ts` passed **12/12 in Chrome**, including the real native-SSE fixture journey and scrolled reading-position stability. After the final current-interest/provenance/link formatting changes, the three affected news/provider browser tests passed **3/3**; the two ingestion/news PostgreSQL acceptance tests also passed. `npm.cmd run build` passed every workspace, including Next.js's new dynamic detail/read routes; existing Vite module directive and three Next instrumentation Edge warnings remain. `npm.cmd run check:browser-boundary` passed. Running the compiled fixture CLI with `NODE_ENV=production` and an unreachable database exited **1** with the expected guard message before connection.

Initial failures were corrected, not hidden: the sandbox engine cache needed copying to a workspace `.exe` for migration execution; Redis database 16 was outside the default 0–15 range; a fixed-point assertion expected `4` instead of the actual `4.0000000000`; the old cache test needed the new `:m16` DTO namespace; a retained prior browser fixture required an article-scoped read-label assertion; provider cadence needed explicit 1000 ms configuration and a timeout covering its three polling transitions; readiness fixtures needed required DATA_MODE; and live Next type generation raced a typecheck, resolved through supported `next typegen` after stopping dev. Final checks above passed. The full API infrastructure suites remain opt-in and were not rerun; the new HTTP ownership/detail/read behavior and SSE are exercised with actual cookies in the live browser acceptance.

**How to demonstrate it:** Exact environment, engine workaround, build/migration/seed commands, four terminal commands, UI steps and test opt-ins are in `docs/lessons/16-live-news-experience.md`. Start API/Vite plus independently selected ingestion/outbox worker roles in local mock mode. Sign Alice into `/news`, choose Watchlist only or Long term, then run `npm.cmd run news:inject --workspace=@portfolio-pilot/worker -- lesson16-demo 1`. Show updates, inspect NOVA exposure, mark read, repeat revision 1, inject revision 2, then repeat revisions 2 and 1. One article ID remains; history/freshness/read revision update correctly. Bob's unrelated feed stays absent, and detail/read return 404. Acceptance used local PostgreSQL port 5546 and Redis databases 6/7; browser and infrastructure tests should use separate DBs or run sequentially because they share a durable outbox. Local development servers started for acceptance were stopped after checks; infrastructure containers were retained.

**Remaining limitations:** No required milestone 16 local checks are blocked. No live provider/AI/cloud verification or public deployment attempted. Only normalized title/summary text is rendered; full publisher HTML is not fetched. Detail history and notification counts are bounded to 100; the accepted observation is independently available. Read receipts synchronize to another tab on its next authoritative read, without a dedicated SSE receipt event. Pagination is current-state rather than historical snapshot pagination: publication-time corrections can move records, reconciled through ID dedupe and explicit refresh. Fixture schedules and demo articles remain in disposable local acceptance databases for inspection. Portfolio impact is deterministic exposure/valuation; cited AI analysis remains milestone 21. Existing build warnings are unchanged. Next work is milestone 17 only.

## Previous milestone report — 15

**What works:** One reusable SSE manager is shared within the authenticated React tree. Authentication mounts a user-keyed provider; logout, session expiry and identity changes clear the old query cache and dispose that scope's stream, cursor and UUID history. StrictMode cleanup/setup shares one recovery/connection through deferred subscription cleanup. The existing API captures signed user/market cursors before authorized snapshots. The browser installs those snapshots before subscribing, cancels old reads, reconciles derived reads and replays notifications after the captured cursor. Strict Zod validation rejects malformed or mismatched named events. Domain UUID deduplication is independent of cursor advancement, bounded to 2,000 entries and kept in memory. Reconnect uses the latest cursor with capped retry; offline/online transitions preserve it only within the current scope. Expired/trimmed/reset/malformed streams recover with a fresh authorized snapshot. News updates default and specified portfolio feeds; quote events target affected quote/holding summaries; portfolio/watchlist events target their lists, summaries, transaction pages and relevant news. Explicit query cancellation prevents an initial pre-event fetch from hiding an update. Live/Reconnecting/Offline labels describe app delivery and retain upstream polling/delay/synthetic labels. News now includes an authorized persisted feed alongside the existing provider samples.

**Changed files:** Created `apps/web/src/lib/stream-manager.ts`, `stream-manager.test.ts`, `apps/web/src/streaming.tsx`, `apps/web/e2e/streaming.spec.ts`, `docs/lessons/15-frontend-streaming-and-recovery.md`. Modified `apps/web/src/auth.tsx`, `market.tsx`, `styles.css`, and this state. Generated web distribution and shared build/Prisma outputs refreshed. No dependency versions, lockfile, API routes, migrations, instruction files or milestone plan changed. This directory is still outside Git; no commit, push or deployment.

**Check results:** `npm.cmd ci --ignore-scripts --offline --cache .npm-cache` restored 348 packages with zero audit vulnerabilities. `npm.cmd run typecheck` initially failed on Prisma's user-cache `utime` EPERM; rerunning with `PRISMA_SCHEMA_ENGINE_BINARY` pointing at the existing readable cached engine generated Prisma successfully and passed every workspace typecheck. `npm.cmd run test --workspace=@portfolio-pilot/web` passed **10/10** (five existing and five new). `npm.cmd run build --workspace=@portfolio-pilot/web` passed with the existing module directive warnings. `npm.cmd run check:browser-boundary` passed. `npm.cmd run test:browser --workspace=@portfolio-pilot/web -- streaming.spec.ts` passed **6/6** in Chrome against the Vite StrictMode app. Coverage includes one shared subscription, targeted updates, duplicate UUID cursor advancement, native EventSource replay/reconnect, persisted news, quote valuation, offline/online, retained-event expiry, invalid payload recovery and logout/Alice-to-Bob isolation. Initial browser failures exposed a far-future test expiry overflowing the timer, transient reconnect assertions and an unnecessary refetch of the freshly recovered default news feed; fixtures/coordination and cache reconciliation were corrected. The quote assertion was corrected to the existing USD display format. No tests were skipped or weakened. The browser suite controls API responses/stream delivery; it does not claim a full running PostgreSQL/Redis/worker journey.

**How to demonstrate it:** Exact environment/workaround commands and UI steps are in `docs/lessons/15-frontend-streaming-and-recovery.md`. For credential-free browser acceptance start `npm.cmd run dev --workspace=@portfolio-pilot/web`, then run `npm.cmd run test:browser --workspace=@portfolio-pilot/web -- streaming.spec.ts`. For the integrated local demo configure the shared seeded PostgreSQL/Redis/API environment from lesson 14; run `npm.cmd run build`, `npm.cmd run seed:demo --workspace=@portfolio-pilot/db`, `npm.cmd run dev`, and separate worker terminals using `WORKER_ROLE=ingestion` and `WORKER_ROLE=outbox` with `npm.cmd run start --workspace=@portfolio-pilot/worker`. Sign in as Alice in two tabs, rename in one and observe the other update; view persisted news, toggle DevTools Offline/Online, then sign out and sign in as Bob.

**Remaining limitations:** No required local checks remain blocked; the sandbox Prisma workaround is documented. The full infrastructure-backed browser journey and previous browser suites requiring seeded infrastructure were not rerun; native browser transport is verified with controlled SSE response bytes, and server integration remains the milestone 14 recorded result. No live provider/AI/Azure verification attempted. Cursor/UUID state intentionally does not survive page reload or logout: a fresh authorized snapshot supplies recovery. Duplicate events older than the bounded UUID window cause harmless targeted refetches. Agent events are validated but their rendering remains milestones 18–19. Provider samples still poll every five seconds; complete news filters/details are milestone 16.

## Previous milestone report — 14

**What works:** `GET /api/events` is a dynamic Node.js Route Handler using the existing HttpOnly session cookie. Responses are `text/event-stream` with private/no-cache/no-store/no-transform, `Vary: Cookie` and `X-Accel-Buffering: no`. Heartbeat comments run every 15 s; abort/body cancellation clears listeners, timers and hub subscriptions. Recovery adds a signed composite `cursor` to the existing snapshot, captured from both raw stream positions before the PostgreSQL snapshot. HMAC-SHA256 binds positions to the authenticated user using AUTH_SECRET; the cursor is not an access credential. Last-Event-ID overrides the original cursor query on automatic reconnection. Unknown/token query parameters and repeated cursors return 400; invalid/foreign/fresh/expired/trimmed/epoch-changed positions emit a validated `stream.reset`, clear the ID and close to the fixed authenticated recovery URL. Every process independently polls retained Redis ranges every 500 ms after the previous poll; equal scope/cursor cohorts share read promises and local fan-out, including market reads across owners. No consumer groups, blocking Redis commands or per-browser Redis connections. Stream Redis connection attempts are coalesced. Bounds: 256 connections/process, 16/user, 100 entries/read, 64 KiB byte queue with 512 bytes reserved for slow-client reset, 2 s operation deadlines, 2,000 remembered event UUIDs/client. Duplicate publications are suppressed within a connection and advance the cursor. Session expiry has an exact timer; database-backed revalidation every 30 s closes revoked/failed sessions within at most 32 s. Browser DTOs use a separate strict Zod allowlist for news/quotes/portfolio/watchlist and the requested agent and reset event types. Projection removes audience/owner, source-event IDs and internal metadata; internal system events never leave the API.

**Changed files:** Created `packages/contracts/src/browser-events.ts`; `apps/api/app/api/events/route.ts`, `route.test.ts`; `apps/api/lib/event-cursor.ts`, `browser-event.ts`, `event-hub.ts`, `event-response.ts`, `events.ts`, `events.test.ts`, `events.integration.test.ts`; `docs/decisions/0008-authenticated-sse-fanout.md`, `docs/lessons/14-replayable-authenticated-sse.md`. Modified `packages/contracts/src/index.ts`, the events recovery route, ADR index and this state. No dependencies, lockfile, migrations, instruction files or milestone plan changed. Generated Prisma/build outputs refreshed. Still outside Git; no commit/push/deployment.

**Check results:** Restored 348 packages with `npm ci --ignore-scripts --offline --cache .npm-cache` (via the installed npm CLI). Initial typecheck hit EPERM while Prisma attempted to timestamp its user-level engine cache. Pointing generation at the cached engine allowed generation, but migrations could not execute the extensionless Windows cache file. Copied that existing engine into `node_modules/@prisma/engines/schema-engine-windows.exe` and set PRISMA_SCHEMA_ENGINE_BINARY to its absolute path; then all five existing migrations deployed successfully to the new disposable `portfolio_m14_verify` database. No schema changes needed. Initial new tests found a TypeScript fixture error, missing DATA_MODE in route test setup, and an overflow fixture too small to actually fill the queue; all corrected, without weakening assertions. `npm.cmd run build`, `npm.cmd run typecheck`, and `npm.cmd run check:browser-boundary` passed (existing Vite directive and three Next instrumentation warnings only). `npm.cmd run test` with AUTH/PORTFOLIO/INGESTION/OUTBOX/SSE test databases and Redis URLs passed **123 tests, zero skipped**: contracts 8, domain 8, config 7, providers 17, DB 12, agent 3, web 5, API 46, worker 17. New coverage: 7 lifecycle/hub/DTO/cursor unit tests, 4 route tests, 2 real PostgreSQL-session/Redis acceptance tests. SSE-focused final rerun passed 13/13 and API typecheck passed. Live HTTP smoke against `next dev` on 127.0.0.1:3014 passed anonymous 401, Alice/Bob sign-in, signed recovery, foreign cursor reset, SSE/no-transform headers, duplicate publication producing one named notification, actual 15 s heartbeat, fetch abort, Last-Event-ID reconnect despite stale query, and sign-out invalidating the cookie. The temporary server was stopped afterwards.

**How to demonstrate it:** See `docs/lessons/14-replayable-authenticated-sse.md` for exact environment settings, npm commands, EventSource console setup, outbox dispatch, and acceptance-test commands. Start the seeded API/web/worker with the same DATABASE_URL, REDIS_URL and AUTH_SECRET, sign in as Alice, fetch `/api/events/recovery`, and create an EventSource using its signed `cursor`. Rename a portfolio and dispatch the outbox to see the named event. Close/recreate with its last event ID to replay. A foreign cursor returns a reset to the current user's snapshot flow.

**Remaining limitations:** Frontend connection management/cache updates/reset recovery are milestone 15; agent schemas are defined here, while actual authorized agent producers are milestones 18–19. Duplicates across reconnect/snapshot remain valid and require browser UUID deduplication. Cohort polling can issue one user+market read per local client in the worst case; limits keep that bounded, and load measurement belongs to milestone 30. A Redis operation deadline releases subscriptions but cannot cancel an underlying command already sent. AUTH_SECRET must be shared across pods; without it, development cursors reset across process restarts or different processes. Session revocation has the documented 32 s maximum grace window. Two independent hubs were tested against real Redis; deployed ingress buffering/timeouts, real two-pod HTTP failover, and native browser UI recovery remain later milestones. No blocked required local checks remain; no live AI, provider or Azure checks were attempted.

## Previous milestone report — 13

**What works:** Every portfolio (create/rename/archive/trade) and watchlist (add/change/remove) mutation appends a typed `OutboxEvent` with the same transaction client. Each event has a stable UUID, schema version 1, UTC timestamp, owner/audience, entity ID, optional portfolio ID and a Zod-validated payload. A rollback, such as an oversell, discards the change and its event together; idempotent replays emit nothing. Legacy repository mutators now delegate to the services. Ingestion stays global: it emits a market `quote.updated` (security IDs/timestamps only) for newly inserted quotes and an internal `news.article.ingested` event for accepted article changes; identical replays emit nothing. The new `WORKER_ROLE=outbox` claims batches with `FOR UPDATE SKIP LOCKED`, 30 s leases and per-claim tokens. It publishes to per-owner streams or the data-free market stream and acknowledges with a token fence. Failures back off exponentially with jitter (errors sanitized of URLs/credentials); after 8 attempts, or for an unsupported envelope, events become DEAD, with an operator requeue. Published rows are purged after 7 days. System events are fanned out in PostgreSQL to owner-scoped `news.available` events (open non-archived positions or watchlist; only that owner's portfolio IDs) using UUIDv5 IDs and `ON CONFLICT DO NOTHING`. Delivery is documented as at-least-once: a crash between publish and acknowledgement republishes the same UUID, and `EventDeduper`/`consumeOnce` apply it once. Opaque cursors `v1.<epoch>.<entry-id>` are separate from event IDs. Streams are bounded (MAXLEN ~1000 user / ~10000 market, 30-day idle expiry, 7-day replay window). Reads reset on invalid, foreign-epoch, expired, XDEL-gapped or trimmed positions. `GET /api/events/recovery` captures cursors before the owner's PostgreSQL snapshot. Redis cache-aside serves the latest quotes (15 s ± 20 %, missing 5 s) and owner/portfolio news (60 s ± 20 %, user+generation+portfolio keys). Keys are versioned `pp:v1:`; invalidation happens in the dispatcher before XADD. Single-flight works in process and across processes (SET NX PX lock). The cache fails open to PostgreSQL after a 250 ms timeout or any Redis error. New authenticated routes: `/api/quotes`, `/api/news`, `/api/events/recovery`. Financial calculations are not cached.

**Changed files:** Created `packages/db/src/outbox.ts`, `cache.ts`, `event-stream.ts`, `cached-reads.ts`, `recovery.ts`, `redis-keys.ts`; `packages/db/prisma/migrations/20261003090000_outbox/migration.sql` and `20261003093000_outbox_db_clock/migration.sql`; `packages/db/test/outbox-cache.test.ts`; `packages/contracts/test/events.test.ts`; `apps/worker/src/outbox.ts`, `test/outbox.test.ts`, `test/outbox.integration.test.ts`; `apps/api/lib/cache.ts`, `app/api/quotes/route.ts`, `app/api/news/route.ts`, `app/api/events/recovery/route.ts`; `docs/decisions/0007-cache-outbox-and-redis-streams.md`; `docs/lessons/13-caching-and-transactional-outbox.md`. Modified `packages/contracts/src/index.ts` (event envelope, cached DTOs, request schemas); `packages/db/prisma/schema.prisma`, `src/index.ts`, `portfolio-service.ts`, `watchlist-service.ts`, `repositories.ts`, `ingestion.ts`; `packages/config/src/server.ts` and its test (OUTBOX_* settings); `apps/worker/src/index.ts`, `.env.example`, `test/ingestion.integration.test.ts`; `apps/api/lib/authorization.ts`; ADR 0001 (dated clarification appended; decision unchanged), ADR index, `docs/versions.md` (note only) and this state. No dependencies added or upgraded; the lockfile is unchanged. No instruction files, plan or unrelated files changed. Generated Prisma client/build output refreshed. The workspace is still outside Git.

**Check results:** `node_modules` was absent in this folder; `npm ci --ignore-scripts --offline --cache .npm-cache` restored 348 packages. Prisma validate/generate passed. Created the disposable `portfolio_m13_verify` database; `migrate deploy` applied all five migrations from empty and the two new additive migrations to `portfolio_m12_verify`, `portfolio_m08_verify` and `portfolio_m07_auth_verify`. `prisma migrate diff --from-config-datasource --to-schema` against m13 reported an empty migration (no drift; this check had been blocked by P1001 in milestone 06). `npm run build` passed all workspaces, including the three new dynamic routes; only the existing Vite directive and three Next instrumentation warnings appeared. `npm run typecheck` and `npm run check:browser-boundary` passed. Final `npm run test` with DATA_MODE=mock, AUTH/PORTFOLIO/INGESTION test databases plus `OUTBOX_TEST_DATABASE_URL` (m13) and `OUTBOX_TEST_REDIS_URL=redis://127.0.0.1:6379/13` passed **110 tests, zero skipped**, twice in a row: contracts 8, domain 8, config 7, providers 17, DB 12, agent 3, web 5, API 33, worker 17 (nine real PostgreSQL+Redis outbox acceptance tests, the extended ingestion acceptance test, and five dispatcher unit tests). Problems found and fixed during verification: (1) we assumed `max-deleted-entry-id` detects trimming, but a live Redis probe showed it does not, so a conservative head-trim rule was added and tested; (2) a test expected `102.50` where Decimal output is `102.5`; (3) combined runs failed intermittently because Prisma's client-side `now()` stamped `availableAt` from the Node clock while claims use PostgreSQL time. The column is now database-generated (`clock_timestamp()`, follow-up migration). Afterwards 8/8 combined worker runs and two full-suite runs passed. CLI smoke on m13: demo seed; `WORKER_ROLE=ingestion WORKER_ONCE=true` committed 4 pages (28 mock articles, quote events PENDING); `WORKER_ROLE=outbox WORKER_ONCE=true` printed `{"claimed":1,"published":1,...}` then `{"claimed":3,"published":3,...}`, and `pp:v1:events:market` reached length 4. No news fan-out occurred because mock articles mention only the seed's ambiguous ACME ticker (correct milestone 12 behavior). Live HTTP smoke against `next dev` with demo auth: anonymous `/api/news` 401; Alice and Bob sign-in 200; `/api/quotes` returned three persisted synthetic quotes with key PTTL ≈ 14.7 s; Alice's portfolio news 200; Bob requesting Alice's portfolio news 404; `limit=500` 400; recovery returned epoch cursors, the retention policy and only Alice's portfolios. An idempotent re-add of an already watched security correctly emitted no event. Adding a new watchlist item (201) then running the outbox worker published one event, raised Alice's generation 0→1 and wrote her stream entry; the next news read created a `g1` key. The dev server was stopped afterwards. Browser UI tests were not rerun (no frontend changes). `npm audit` was not rerun (no dependency changes; milestone 12's four Prisma-tooling advisories still stand).

**How to demonstrate:** Follow [Lesson 13](lessons/13-caching-and-transactional-outbox.md). With m13 `DATABASE_URL`, `REDIS_URL=redis://127.0.0.1:6379/13` and DATA_MODE=mock: migrate, build, seed, run the worker once as `ingestion` and once as `outbox`, then inspect `OutboxEvent` and `XRANGE pp:v1:events:market - +`. For HTTP, run the API with demo auth, sign in as Alice at http://localhost:5173 and call `/api/news`, `/api/quotes?securityId=demo-nova` and `/api/events/recovery` from the console. Add a watchlist item, dispatch, and watch the generation and stream change. Run `npm.cmd run test --workspace @portfolio-pilot/worker` with `OUTBOX_TEST_DATABASE_URL`/`OUTBOX_TEST_REDIS_URL` (loopback, `*_verify`) for the full acceptance suite.

**Remaining limitations:** No SSE yet: the stream readers, dedupe helper and recovery route are consumed by tests and the recovery API; browser streaming is milestones 14–15. Events for one owner can arrive slightly out of order across dispatcher replicas; consumers must treat them as hints and refetch or reconcile, not apply blind deltas. Fan-out uses interest at dispatch time. The trim detector may reset unnecessarily at the exact trim boundary (it never skips). The market stream at ~2,880 quote batches/day keeps ~3.5 days within its 10,000-entry bound, so its effective replay window is shorter than 7 days; cursors beyond it reset. An owner's cached news reflects their own write after dispatch latency (normally ≤ one 500 ms poll), or after the 60 s TTL if the dispatcher is down. Redis streams of deleted users are not removed eagerly; they expire after 30 idle days. DEAD events need operator action (`requeueDead`); there is no admin UI or metrics export yet (milestones 30/32). Cache statistics are in-process counters only. Live Alpaca and Entra remain unverified as before. The `portfolio_m13_verify` database (seeded, with the smoke rows) and Redis logical DB 13 keys under `pp:v1:` were retained for demonstration; test-namespace keys and rows were cleaned up. No paid resources, cloud provisioning, deployments, commits or pushes.

## Previous milestone report — 12

**What works:** Selected Alpaca from official HTTP API, OpenAPI, plan and usage-term research; ADR 0006 records the choice and alternatives. Separate server-only quote/news exports implement last-IEX-trade decimal prices, documented Benzinga metadata, fixed-window token pagination, UTC dates, conservative 15-minute news delay, bounded HTTP timeout, redirects denied, response validation and sanitized errors. Full text is explicitly not requested and never retained. Credentials come from validated server configuration; live construction requires both supplied keys and explicit confirmation of applicable storage/display rights. Mock operation requires neither. The ingestion worker independently selects its role, persists its initial schedule epoch and page/checkpoint progress, stores quotes and normalized articles transactionally, deduplicates provider IDs and canonical URLs, retains URL/source aliases and immutable correction observations, and associates only unambiguous supported securities. Corrections remove obsolete current security associations while history remains. PostgreSQL time, expiring leases, generation fencing and commit-time row locks prevent competing replicas/stale owners from committing duplicate scheduled work. Retry times/failure counts survive restart, with exponential jitter and provider guidance. No provider failure advances progress. Real process restart and duplicate replay passed.

**Changed files:** Created `packages/providers/src/server.ts`, `test/alpaca.test.ts`, `test/fixtures/alpaca.ts`; `packages/db/src/ingestion.ts` and `prisma/migrations/20261002120000_ingestion/migration.sql`; `apps/worker/src/ingestion.ts`, `test/ingestion.test.ts`, `test/ingestion.integration.test.ts`; `docs/decisions/0006-alpaca-and-durable-ingestion.md` and `docs/lessons/12-live-providers-and-ingestion.md`. Modified provider index/manifest, server configuration, DB index/schema/manifest, worker index/manifest/env example, package lock, ADR index and this state. Added only existing pinned Zod and local workspace dependencies; no version upgrades, instruction rewrites, plan changes, removals, commits or pushes. Generated build/Prisma artifacts were refreshed. This workspace remains outside Git.

**Check results:** Initial offline npm installation failed with ENOTCACHED; approved `npm.cmd install --ignore-scripts --cache .npm-cache` passed (346 installed packages). Initial `npm.cmd run typecheck` hit Prisma engine-cache EPERM; approved retry passed all workspaces, and a later full typecheck also passed. `npm.cmd run build` passed all workspaces, retaining existing Vite directive and three Next instrumentation/Edge warnings. After final changes, provider/DB/worker builds and DB/worker typechecks passed; the final optional-empty mock-epoch config change passed its build and all six config tests. `npm.cmd run check:browser-boundary` passed. Created the disposable local `portfolio_m12_verify` database; `npm.cmd run migrate:deploy --workspace @portfolio-pilot/db` applied all three migrations from empty, and the additive migration also passed on the existing dedicated API acceptance databases. Final `npm.cmd run test`, with DATA_MODE=mock and all three test-database variables, passed **83 tests, zero skipped**: contracts 4, domain 8, config 6, providers 17, DB 4, agent 3, web 5, API 33, worker 3. Observability has no tests. The worker PostgreSQL test covers real claims/transactions, pagination/restart, quote storage, duplicate/tracking-URL replay, corrections, source/URL bridge merge, association retraction, outage/recovery, rollback and expiry fencing. Earlier full tests exposed a missing test-shell DATA_MODE, an incorrect alias-count expectation, and a genuine initial-schedule clock sensitivity; corrected before final passing checks. The CLI smoke seeded only the milestone 12 database and started WORKER_ONCE mock ingestion twice successfully; inspection showed generation 3, checkpoint/cursor through 104 records, failures 0, and 104 distinct ingested articles despite duplicate delivery. The database was retained for demonstrations. Browser tests were not rerun because no frontend/API flow changed. Live smoke **not run**: no supplied credentials or confirmed storage/display entitlement. `npm.cmd audit --json` returned exit 1 with four high-severity findings in existing Prisma tooling/transitives (`prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`); no automatic or breaking dependency fix was applied.

**How to demonstrate:** Exact environment, migration, seed, worker and SQL inspection commands are in [Lesson 12](lessons/12-live-providers-and-ingestion.md). With a migrated/seeded loopback database, set DATA_MODE=mock, WORKER_ROLE=ingestion, MOCK_NEWS_INTERVAL_MS=1000 and INGESTION_INTERVAL_MS=1000; run `npm.cmd run start --workspace @portfolio-pilot/worker`. Restart with the same settings, or start a second replica, and inspect IngestionState, NewsArticle, NewsObservation and QuoteSnapshot. Use WORKER_ONCE=true for a single due page. Run `npm.cmd run test --workspace @portfolio-pilot/worker` with INGESTION_TEST_DATABASE_URL pointing to the dedicated migrated loopback *_verify database. Portfolio summaries can read the persisted quote rows when the API uses that database; `/news` still uses the milestone 11 mock snapshot service. No UI step is needed to inspect durable ingestion.

**Remaining limitations:** Live API calls, news entitlement, licensed storage/history and multi-user display remain unverified. Before live smoke, supply ALPACA_API_KEY/ALPACA_API_SECRET and documented applicable rights, then explicitly enable ALPACA_STORAGE_DISPLAY_RIGHTS_CONFIRMED, set DATA_MODE=live plus DATABASE_URL/REDIS_URL, and run WORKER_ONCE=true with `npm.cmd run start --workspace @portfolio-pilot/worker`. Basic access alone is not redistribution permission. IEX last trades are limited-venue prices, not consolidated SIP/NBBO. News is polled with a 15-minute cutoff; initial lookback is 24 hours and correction overlap one hour. Older corrections require backfill; null-URL articles are omitted and ambiguous catalog tickers are not associated or quoted. Work exceeding the 120-second lease safely fails its commit and replays; very large catalogs may require quote-batch scheduling in a later slice. Invalid checkpoints require operator investigation rather than silent reset. API cache/outbox/news-stream consumption of durable records belongs to milestones 13 onward. Dependency advisory remediation remains a separate compatibility-reviewed task; rerun `npm.cmd audit` to inspect it. No required local acceptance check remains blocked. No paid services, cloud resources, public deployments or external messages were created.

## Previous milestone report — 10

**What works:** Dashboard and Portfolios use authenticated API data, replacing portfolio fixtures. Create/edit/archive dialogs, buy/sell forms, ten-entry transaction pages, holdings (including sold-out positions), four summary cards and allocation bars use persisted records and server-calculated metrics. Raw trade strings are preserved; BigInt/string display formatting deliberately rounds money without floating-point accounting. Quote rows show UTC timestamps, USD currency context, provider, synthetic flags and fresh/stale/missing/invalid/not-required status. Empty portfolios, loading/errors/retry, null valuations and read-only archives are explicit. Mutation controls use synchronous locks and disabled fields; unchanged trade retries retain their backend idempotency key while the dialog is open. Native confirmation dialogs contain keyboard focus, allow cancellation and restore the original trigger, including React Strict Mode. API 401s clear account caches and return to sign-in. Authenticated securities and watchlist endpoints offer exchange-aware USD stock selection and owner-scoped list/add/edit/remove. Upserts/uniqueness prevent duplicate watchlist securities; client owner IDs are rejected. Alice and Bob independently manage portfolios and watchlists; refresh preserves data.

**Changed files:** Created apps/web/src/portfolio.tsx, src/lib/decimal-display.ts and its test, e2e/portfolio.spec.ts; packages/db/src/watchlist-service.ts; apps/api/app/api/securities/route.ts, watchlist/route.ts and watchlist/[id]/route.ts; docs/lessons/10-portfolio-ui-and-watchlist.md. Modified web app.tsx, auth.tsx, styles.css, api-client.ts and e2e/shell.spec.ts; contracts/src/index.ts; db/src/index.ts; API authorization.ts, portfolio-http.ts and portfolio.integration.test.ts; this state. No migrations, dependency/version/lockfile changes, instruction rewrites, project-plan changes or removals. Generated ignored build/client/test artifacts were refreshed. This workspace remains outside Git, so no diff/commit was available.

**Check results:** npm ci --ignore-scripts --offline passed (347 installed packages, zero audit vulnerabilities). Initial npm run typecheck was blocked by sandbox EPERM touching the installed Prisma engine cache; the approved cache-access retry passed all workspaces. npm run build passed all workspaces; after the final modal/encoding fix, npm run build --workspace @portfolio-pilot/web passed again with TypeScript validation. Existing Vite TanStack directive and three Next instrumentation Node/Edge warnings remain. npm run check:browser-boundary passed. npm run test with PORTFOLIO_TEST_DATABASE_URL and AUTH_TEST_DATABASE_URL passed all 57 tests, none skipped (including 27 API tests and five frontend client/format tests). New real PostgreSQL acceptance verifies exchange ambiguity, authentication, add replay, independent users, foreign edit/delete rejection, updates, invalid identities/owner fields and removal. Final npm run test:browser --workspace @portfolio-pilot/web with PORTFOLIO_E2E_DATABASE_URL passed all four Chrome scenarios in 24.3 seconds against the actual Vite proxy/Next API/PostgreSQL stack. The new scenario checks all reference values, refresh, two-user create/watchlists, canceled/confirmed removal, full liquidation, second history page, rename/archive persistence and a simulated 401. Earlier browser runs exposed outdated/ambiguous test selectors, Chrome datetime fill normalization, the existing transaction API's 200 status, and a real Strict Mode modal focus-restoration issue; corrected before final passing acceptance. Desktop/mobile screenshots inspected or captured; mobile layout assertion passed. Commands used installed Node 24.21.0/npm 11.19.0 with the nvm installation directory prepended to PATH.

**How to demonstrate:** Run npm run dev with the migrated/seeded local API environment, open http://localhost:5173 and sign in as Alice Demo. Open Portfolios, create a portfolio, select ACME / XNAS / USD, then record buys 10 @ 100 + 2 fees and 5 @ 120 + 1 fee, followed by selling 6 @ 130 − 3 fees using the UTC dates in [Lesson 10](lessons/10-portfolio-ui-and-watchlist.md). Expect nine shares, USD 961.80 remaining basis and USD 135.80 realized gain; seed quotes are historical and show stale/unavailable valuation. The browser acceptance inserts its own temporary fresh USD 125 quote and verifies USD 1,125.00 market value and USD 163.20 unrealized gain. Refresh/reselect, rename/archive, and add/edit/remove watchlist items. Sign out/in as Bob to observe isolated data. Lesson 10 gives exact commands for every check and dedicated loopback database/browser environment. Local verification used the existing portfolio_m08_verify database on port 5546 and portfolio_m07_auth_verify for auth tests.

**Remaining limitations:** Live security search, quotes and ingestion belong to later milestones; only the persisted supported USD stock catalog is selectable. News and general assistant retain their explicit demo behavior. Stale seed quotes do not produce market values or allocations. Displayed rounded rows/weights may not sum exactly; full-precision accounting stays server-side. Trade retry keys survive errors within the open dialog, not closing/reopening; check history before re-entering an uncertain request. History offsets can shift with concurrent/backdated inserts. Real Entra still needs credentials for live sign-in verification. No blocked required local checks remain, no cloud resources/public deployments/commits/pushes occurred, and only this run's disposable acceptance resources were cleaned up.

## Previous milestone report — 09

**What works:** Pure domain replay calculates remaining quantity, weighted average acquisition cost, remaining/sold basis, realized gain/loss, market value, unrealized gain/loss and allocation ratios. Reduced BigInt rational arithmetic preserves exact decimal precision internally; buys include fees in basis, sales subtract fees from proceeds, partial sales retain unit cost, and liquidation leaves no residual basis. Output rounds half up (negative ties away from zero): money to two decimals, quantity/unit cost/ratios to ten; totals round after exact aggregation. Reference case passes every stated amount. Trades sort by UTC time then unique ledger order and reject any chronological oversell, invalid decimals, future trades, duplicate order or excessive sell fees. Latest nonfuture quotes expose provider/time/synthetic metadata and fresh/stale/missing/invalid/not_required states under an explicit 15-minute policy. Unpriced open positions yield null valuations; incomplete portfolios yield null market/unrealized totals and allocation weights rather than invented zero prices. Closed positions need no quote. No investment-return percentage claims. GET /api/portfolios/:id/summary uses authenticated owner contexts, consistent repeatable-read ledger/quote snapshots, browser-safe Zod DTOs and no-store headers; foreign/missing IDs return identical 404, anonymous requests 401, archived portfolios remain readable.

**Changed files:** Created packages/domain/src/decimal.ts, valuation.ts and valuation.test.ts; packages/db/src/summary-service.ts; apps/api/app/api/portfolios/[id]/summary/route.ts; docs/lessons/09-valuation-and-performance.md and docs/decisions/0005-exact-valuation-and-quote-policy.md. Modified domain exports and package test script (source-only discovery avoids compiled test duplicates), contracts/src/index.ts, db exports, API authorization and portfolio integration tests, decision index and this state. No schema/migration, dependency version, lockfile, instruction or plan changes; no files removed. Builds regenerated ignored dist/client artifacts.

**Check results:** npm ci --ignore-scripts --offline restored 347 pinned packages, zero audit vulnerabilities reported. npm run typecheck passed all workspaces; initial sandboxed Prisma generation failed EPERM on engine cache, and retry with engine-cache access passed. npm run build passed all workspaces, including the dynamic summary route; existing Vite directive warnings and three Next instrumentation Node/Edge warnings persist. npm run check:browser-boundary passed. Final npm run test with PORTFOLIO_TEST_DATABASE_URL and AUTH_TEST_DATABASE_URL passed 55 tests (including eight distinct domain tests and all 26 API tests), none skipped. Seven new domain tests cover reference amounts/unit-cost invariance, liquidation/rebuy, fractional/repeating precision, quote failures and freshness boundary, allocations/empty portfolios, chronological validation and rounding. New real PostgreSQL summary acceptance covers stale totals, reference valuations with a fresh synthetic quote, no-store, anonymous/foreign/missing access and archive readability; all nine portfolio acceptance tests passed. Earlier credential-free run passed 46 executions with 17 integration skips; it included duplicated compiled domain tests, corrected by source-only discovery before the final run. Actual commands used installed Node 24.21.0 with npm-cli.js at C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0/node_modules/npm/bin/npm-cli.js and its bin directory prepended to PATH. Initial Docker inspection was denied in the sandbox; approved local inspection found the existing verification container and databases, with no new infrastructure required.

**How to demonstrate:** [Lesson 09](lessons/09-valuation-and-performance.md) includes formulas, rounding rules and exact commands. Run npm run dev with the existing local database configuration, sign in as Alice at http://localhost:5173, use lesson 08's helper to create/post the reference ledger, then await send(`portfolios/${id}/summary`, 'GET'). Seed quotes correctly appear stale; the dedicated PostgreSQL test creates a temporary fresh $125 synthetic quote to verify $1,125 market value and $163.20 unrealized gain. Sign in as Bob and request Alice's summary to get 404. Run npm run test --workspace @portfolio-pilot/domain for the pure reference case. Set PORTFOLIO_TEST_DATABASE_URL to the existing loopback portfolio_m08_verify database and run npm run test --workspace @portfolio-pilot/api for authenticated summary acceptance; AUTH_TEST_DATABASE_URL can additionally target portfolio_m07_auth_verify.

**Remaining limitations:** Portfolio UI continues to use fixtures until milestone 10; no browser/network smoke was run for the summary route (real session/Route Handler/PostgreSQL acceptance passed). Optional manual next command: npm run dev, then follow lesson 09's console steps. Quote age policy is conservative and not calendar-aware; live providers/ingestion remain milestones 11–12. Rounded rows/weights may not sum exactly to rounded totals/one. Exact fractions and full ledger replay can become costly for very long histories. No cash-flow-adjusted/time-weighted investment returns, dividends, FX or corporate actions. No blocked required local checks remain; real Entra remains unverified without credentials as previously documented. Only this run's acceptance portfolios/fresh quote were cleaned up; no application data reset, paid resources, public deployment, commits or pushes. This folder is not a Git repository.

## Previous milestone report — 08

**What works:** Authenticated GET/POST /api/portfolios, GET/PATCH/DELETE /api/portfolios/:id, paginated GET and idempotent POST /api/portfolios/:id/transactions. Thin Node.js Route Handlers call an owner-scoped application service using shared Zod contracts. Portfolio edits rename only; DELETE archives without erasing history, and archives remain readable but reject new financial entries/renames. Trades are immutable; financial corrections use explicitly posted compensating entries under the documented restrictions. Plain decimal strings fit storage precision; positive quantity/price, nonnegative fees, USD stock symbol/exchange identity, calendar-valid UTC millisecond dates, no future trades, amount overflow and sell fees above proceeds are checked. BigInt fixed-point arithmetic calculates quantities and amounts exactly; amounts round half up to ten places. Full chronological ledger validation rejects oversells at any prefix, including later sales affected by backdating. PostgreSQL sequence orders equal-time trades deterministically. Owner-filtered row locks serialize trades, rename and archive in one database transaction with bounded lock/pool/transaction timeouts and three conflict attempts. Per-portfolio unique idempotency keys plus canonical request fingerprints prevent duplicate posting, reject changed-payload reuse and support exact replays after archive. No Redis dependency for financial correctness.

**Changed files:** Added packages/db/src/portfolio-service.ts and prisma/migrations/20261001080000_portfolio_api/migration.sql; added packages/domain/src/ledger.ts and ledger.test.ts; added apps/api/lib/portfolio-http.ts, portfolio.integration.test.ts, portfolio collection and transaction Route Handlers. Modified portfolio resource Route Handler, authorization.ts and http.ts; contracts/src/index.ts; db schema, repositories, exports, manifest and database verifier; domain exports; package-lock.json. Added ADR 0004 and lesson 08; updated decision index, versions and this state. No instruction files or milestone plan changed; no dependencies upgraded, no application data reset.

**Check results:** npm ci installed 347 packages; npm shim's trust delegation initially failed, so actual commands used node with the installed npm-cli.js at C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0/node_modules/npm/bin/npm-cli.js. npm run typecheck passed all workspaces after allowing Prisma access to its installed engine cache (initial sandboxed generation failed EPERM). npm run build passed web/API/worker, and final API rebuild passed after retry error-mapping correction. Prisma validate passed. migrate:deploy applied both migrations to fresh local portfolio_m08_verify and the additive migration to existing disposable portfolio_m07_auth_verify. npm run test with both PORTFOLIO_TEST_DATABASE_URL and AUTH_TEST_DATABASE_URL passed 48 tests total, including all 25 API tests with eight new real PostgreSQL acceptance tests and eight existing authentication checks; no integration tests skipped in that final run. Earlier credential-free suite passed 32 local tests with optional integration suites skipped. Browser boundary check passed. New acceptance covers invalid input/zero writes, names and immutable fields, anonymous/origin rejection, every cross-owner resource method, concurrent duplicate/reused keys, archived replay/history, equal-time order, different exchange inventory, pagination, backdating, conflicting sales, archive race, amount overflow/rounding/tiny fractions and bounded lock exhaustion/recovery. First acceptance run used nonexistent AAPL instead of synthetic ACME and was corrected. Lock-timeout test exposed Prisma adapter nested originalCode metadata; retry classification was corrected and rerun successfully. Existing Vite directive warnings and three Next instrumentation Node/Edge warnings remain. Historical standalone milestone 06 database verifier was adapted to archive/errors/bigint serialization but not rerun; the new milestone 08 tests exercise these behaviors directly.

**How to demonstrate:** See [lesson 08](lessons/08-portfolio-and-transaction-apis.md) for exact setup, browser-console API calls and test commands. With local DATABASE_URL configured, run npm run build:types, npm run migrate:deploy --workspace @portfolio-pilot/db, then npm run dev; sign in as Alice at http://localhost:5173. Create a portfolio, post ACME/XNAS BUY with Idempotency-Key, replay it, attempt quantity-11 SELL against quantity-10 inventory (409), paginate, rename and archive; history survives. Sign in as Bob and request Alice's ID (404). Financial screens still show fixtures until milestone 10. For tests set PORTFOLIO_TEST_DATABASE_URL to the dedicated loopback portfolio_m08_verify database and run npm run test --workspace @portfolio-pilot/api; optionally set AUTH_TEST_DATABASE_URL to portfolio_m07_auth_verify to rerun authentication acceptance too.

**Remaining limitations:** Offset pagination is not a snapshot across requests; refresh from zero after backdated inserts. Validation scans the full ledger and is linear in history. Compensating entries do not erase historical accounting effects; corrections that cannot maintain long-only intermediate inventory require a future audited workflow. No restoration, transaction editing/deletion, valuation or UI integration is in this slice. No live browser/network smoke was run for the new routes; acceptance directly invokes actual Route Handlers with real signed sessions and PostgreSQL. Next optional manual verification: npm run dev, follow lesson 08 console calls after Alice sign-in, then repeat as Bob. Real Entra remains unverified as documented in milestone 07. Privileged SQL and explicit local seed operations are outside supported application mutation paths. No paid resources, public deployment, commits or pushes; this folder is not a Git repository. The disposable local milestone 08 database remains available and only this run's created test portfolios were cleaned up.

## Previous milestone report — 07

**What works:** Better Auth 1.7.7 Prisma-backed eight-hour absolute sessions with signed HttpOnly/SameSite=Lax cookies (Secure in production), no cookie caching or password auth, local demo plugin restricted to explicit dev/test loopback opt-in and two seeded aliases, logout/replay invalidation, expiry, GET /api/me, protected frontend gate and query-cache clearing. Production configuration requires HTTPS, persistent secret, PostgreSQL and tenant-specific Entra settings; invalid production configuration terminates startup with exit 1. Microsoft OIDC provider disables account auto-linking and encrypts provider tokens. Reusable requireAuthorization/requirePortfolio mint the existing opaque repository contexts from verified current sessions. Read-only portfolio resource route uses owner filtering and identical safe 404s for foreign/missing IDs. Every application non-health route is authorized, including the temporary AI route, which also requires local development and demo opt-in. Auth options/sign-in/callback are intentionally public handshake endpoints; other raw library endpoints are blocked. Strict exact-origin mutations supplement enabled library CSRF/state/nonce checks. No CORS headers or public deployments.

**Changed files:** Added apps/api/lib/auth.ts, authorization.ts, auth.test.ts, auth.integration.test.ts, auth catch-all Route Handler, /api/me and owner-scoped /api/portfolios/[id]; modified demo AI POST, lib/http.ts, instrumentation.ts, API manifest/env example and package-lock.json; added apps/web/src/auth.tsx and modified App.tsx; extended server configuration. Added ADR 0003, lesson 07 and missing root README; updated ADR index, versions and this state. Existing owner-scoped repositories and migration reused unchanged; no instruction files intentionally edited and no dependencies upgraded.

**Check results:** Installed pinned Better Auth and workspace dependencies using the installed npm CLI (nvm npm shim rejected delegated execution). Existing migration deployed successfully to a new local portfolio_m07_auth_verify database in the existing port 5546 PostgreSQL 17.6 container. All API tests with AUTH_TEST_DATABASE_URL passed: 17, including eight PostgreSQL acceptance checks and three auth unit checks. Full npm run test passed: 30 tests, eight optional database tests explicitly skipped without the URL, empty workspaces reported no tests. npm run build and npm run typecheck passed; final API rebuild passed after production-exit hardening. Browser dependency boundary check passed. Live Next.js through Vite proxy verified anonymous 401, demo login, /me, cross-owner 404, authenticated mock AI, forged origin 403, logout and old-cookie replay 401. OIDC fixture checks verified HTTPS Secure cookie config, no demo plugin, single-tenant authorization URL, state, PKCE/openid, foreign callback URL 403 and forged callback error. Production Next startup with DEMO_AUTH_ENABLED=true refused configuration and exited 1. Earlier compile/typecheck failures were corrected (portable inferred return types and installed provider/cookie types); OIDC test initially exposed Better Auth's test-mode origin-check default and explicit security flags now ensure protections run. Vite directive warnings and three Next instrumentation Node/Edge analysis warnings remain. Browser tool reported no available browser, so visual/interaction checks did not run.

**How to demonstrate:** Follow [lesson 07](lessons/07-authentication-and-authorization.md). With local PostgreSQL, copy/merge API .env example, migrate and explicitly seed in development, set DEMO_AUTH_ENABLED=true and AUTH_BASE_URL=http://localhost:5173, then npm run dev. Open exactly http://localhost:5173, choose Alice, inspect /api/me and her demo-growth resource, confirm demo-bob-core is 404, sign out, choose Bob and repeat. Financial screens remain shared static fixtures; API ownership uses actual database rows. For acceptance reruns use AUTH_TEST_DATABASE_URL pointing to the dedicated portfolio_m07_auth_verify database and npm run test --workspace @portfolio-pilot/api. The isolated verification database remains available; no application/previous milestone data was reset.

**Remaining limitations:** Real Entra consent/code exchange/ID-token/JWKS/nonce verification, user persistence/repeat sign-in, optional managed-user email claim and actual HTTPS gateway cookie behavior require tenant credentials and a registered redirect URI. Next command after providing documented production config and same-origin HTTPS gateway: npm run build, npm run start --workspace @portfolio-pilot/api, then click Microsoft sign-in, check /api/me and logout 401. App logout does not terminate Microsoft SSO. Browser visual checks require an available browser: npm run dev and execute the Alice/logout/Bob/reload flow in lesson 07. Demo requires local PostgreSQL but no OIDC/AI/market credentials; ephemeral development secret invalidates cookies across restart. Periodic session cleanup/distributed rate limiting and broader hardening remain later work. Full CRUD/transaction services are milestone 08; connecting financial screens to private API data remains milestone 10. No Git repository exists here; nothing committed, pushed, provisioned or deployed.

## Previous milestone report — 06

**What works:** PostgreSQL schema/migration for User, Session, Account, Verification, Portfolio, exchange-aware Security, PortfolioTransaction, WatchlistEntry, QuoteSnapshot, NewsArticle and NewsArticleSecurity. UTC timestamps, numeric price/quantity/fees/amount columns, SQL CHECK invariants, indexes, unique keys and deliberate cascade/restrict actions. Transactions are the source of truth; no persisted positions. Session-derived opaque contexts protect owner-scoped portfolio/watchlist mutations and ledger/quote/news reads. Financial DTOs use fixed-point decimal strings, including very small fractions. Explicit local-only seed creates two users, three portfolios, five buys/sells, distinct same-symbol listings and synthetic historical quotes/news, with an injected fixture clock and atomic/concurrent idempotency. No credentials or sessions are seeded.

**Changed files:** This empty milestone folder was initialized from milestone 05 without its .git, dependencies or cache; the earlier folder was left unchanged. Added/modified `packages/db/prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/20261001000000_initial/migration.sql`, migration lock, package scripts, `src/index.ts`, `src/repositories.ts`, `src/seed.ts`, `src/seed-cli.ts`, boundary tests and database integration verifier; `packages/contracts/src/index.ts` and ledger contract tests; database diagram, ADR 0002/index, lesson 06, versions notes, README and state. No existing instruction files were edited and no dependency versions changed.

**Check results:** `npm ci --no-audit --no-fund` installed 328 packages after network access was permitted. Prisma 7.10.0 validate/generate passed. Generated SQL plus reviewed CHECK constraints deployed to PostgreSQL 17.6 in an isolated local container on port 5546. The first migration attempt failed before table creation because the schema engine had not generated base SQL; recovered via non-destructive `migrate resolve --rolled-back` and deploy. A second, entirely new database `portfolio_m06_verify_final` received the complete migration directly and passed the final integration verifier: exact row/timestamp equality after repeated/concurrent seeds, synthetic flags, cross-owner reads/mutations, missing/fabricated/expired/revoked contexts, fixed-point tiny decimals, SQL constraints, uniques and cascades. `npm run build`, `npm run typecheck`, `npm run test` (27 tests) and `node scripts/check-browser-boundary.mjs` passed. Existing Vite directive warnings and two Next.js Node/Edge analysis warnings remain. Optional Prisma engine `migrate diff --from-config-datasource --to-schema ... --exit-code` failed P1001 despite the live adapter checks passing; container pg_isready confirmed ready. No database reset ran. The compiled seed CLI also ran twice successfully with explicit local opt-in and printed the synthetic historical-price label both times. The disposable verification container remains available on localhost:5546 for inspection; it does not use the normal Compose volumes.

**How to demonstrate:** Follow [lesson 06](lessons/06-database-and-seed.md) for explicit migration/seed commands and the isolated fresh-database verifier. The normal demo seed requires a loopback DATABASE_URL, NODE_ENV=development/test and ALLOW_DEMO_SEED=true; run it twice. The verifier requires an empty disposable `portfolio_m06_verify` (also accepts `portfolio_m06_verify_final`) database and NODE_ENV=test. It intentionally changes fixture data to verify deletes and must not run against the application database. See [diagram](database-diagram.md) and [ADR](decisions/0002-database-ledger-and-auth.md).

**Remaining limitations:** Actual auth library integration, cookie/session issuance, demo login and Entra OIDC remain milestone 07. Repository contexts must be freshly resolved per request and never cached across logout. Trade APIs, pagination cursors, aggregate long-only/concurrency checks and weighted-average valuation follow in milestones 08/09. The frontend still uses its visibly labeled fixtures. Optional engine-based schema-drift verification is blocked by P1001; with local engine connectivity fixed, rerun `prisma migrate diff --config packages/db/prisma.config.ts --from-config-datasource --to-schema packages/db/prisma/schema.prisma --exit-code` using the port 5546 verification URL. SQL CHECK constraints are not represented by Prisma's schema diff and are verified by integration tests. This workspace has no Git repository; nothing committed, pushed or deployed.
## Previous milestone report — 05

**What works:** Compose defines pinned PostgreSQL 17.6 and Redis 7.4.5 with health checks, localhost-only ports, and named volumes. npm scripts start, stop, and inspect the stack; volume reset requires an explicit flag. The API has separate liveness and dependency readiness routes. Prisma 7 uses the PostgreSQL adapter; Redis uses node-redis with bounded reconnection. URLs are validated, connections are reused, and a shutdown hook closes them. No Azure resources were provisioned.

**Changed files:** `compose.yaml`, `scripts/infra.mjs`, root and workspace package manifests and lockfile, `packages/db` client and schema, server config and tests, API health routes and tests, instrumentation, local environment example, `README.md`, `docs/lessons/05-local-infrastructure.md`, and this state file.

**Check results:** `docker compose -f compose.yaml config --quiet` passed. `npm run build` and `npm run typecheck` passed with existing Vite warnings and two new Next.js Edge analysis warnings for the Node-only shutdown hook. `npm run test` passed its pre-existing 19 tests; the new API readiness tests then passed separately (6 API tests total). Unconfirmed volume reset exited 2 before calling Docker. `npm run infra:status` failed because Docker engine pipe access was denied. The live container/API smoke test was not run.

**How to demonstrate:** Follow the milestone 05 section of `README.md`. With an accessible Docker Linux engine, run `npm run infra:start`, `npm run infra:status`, copy `apps/api/.env.example` to `apps/api/.env.local`, run `npm run build` and `npm run dev`, then request `/api/health/live` and `/api/health/ready`. Run `docker compose stop redis`; readiness should return 503 while liveness stays 200. Restore with `npm run infra:start`. `npm run infra:stop` preserves volumes; `npm run infra:reset -- --confirm-delete-volumes` deletes them.

**Remaining limitations:** Docker pipe access was denied on this host, so PostgreSQL and Redis container health, API access to both, and the readiness transition on dependency stop are unverified. The exact next smoke test commands are above. The Prisma schema has no application models or migrations until milestone 06. This workspace is not a Git repository, so no commit was made.
## Previous milestone report — 04

**What works:** The Assistant screen sends a bounded question to local-development-only `POST /api/demo/ask` and displays a completed answer or an error. `AgentService` has deterministic mock and Claude Agent SDK implementations. Mock answers are labeled. Claude mode requires an explicit server API key and model ID, uses the installed SDK 0.3.276 `query` API, disables built-in tools with `tools: []`, limits a run to one turn, an estimated USD 0.02 SDK budget, and 20 seconds. SDK settings and runtime data are directed to a configured absolute workspace outside the source repository; session persistence is disabled. Missing credentials fail with a clear configuration error and never fall back to mock. The endpoint is unavailable outside local development and is bound to loopback in the API dev script. It is temporary and must be removed when authenticated run endpoints replace it.

**Changed files:** `packages/agent/src/index.ts` and `test/agent.test.ts`; `packages/contracts/src/index.ts`; `packages/config/src/server.ts` and `test/config.test.ts`; `apps/api/app/api/demo/ask/route.ts` and `route.test.ts`, `apps/api/lib/http.ts`, `apps/api/package.json`, `apps/api/.env.example`; `apps/web/src/app.tsx`, `src/styles.css`, `e2e/shell.spec.ts`; `package-lock.json`; `docs/lessons/04-first-agent-slice.md`; this state file. No instruction files were changed.

**Check results:** `npm ci --no-audit --no-fund` installed 302 packages. `npm run build` passed after two TypeScript fixes, including Next.js production compilation and route typecheck. `npm run typecheck` and `npm run check:browser-boundary` passed. `npm run test` passed 18 tests across contracts, config, agent, web, and API. With `npm run dev` running, `npm run test:browser --workspace=@portfolio-pilot/web` passed all three Chrome tests, including a visible mock answer from a browser question. Vite emitted the existing non-fatal third-party `use client` warnings. `ANTHROPIC_API_KEY`, `AGENT_MODEL_ID`, and `AGENT_WORKSPACE_DIR` were absent in this shell; the live SDK smoke test was not run.

**How to demonstrate:** With Node/npm active, run `npm ci`, `npm run build`, then `npm run dev`. Open `http://127.0.0.1:5173/assistant`, enter a question, and select Send message. The result is labeled “Mock answer.” Run `npm run test`, `npm run typecheck`, `npm run check:browser-boundary`, and, while dev servers run, `npm run test:browser --workspace=@portfolio-pilot/web`. On this host use the direct Node 24.21.0/npm CLI invocation described in the milestone 03 report if the npm shim is inactive. For an optional live check, set `AGENT_MODE=claude`, `AGENT_MODEL_ID` to a model available to your Anthropic API account, `AGENT_WORKSPACE_DIR` to an absolute path outside this repository, and `ANTHROPIC_API_KEY` in the API server environment, restart dev, then ask one short question. The SDK budget remains USD 0.02; no account login is used.

**Remaining limitations:** Live Claude behavior is unverified because no application API key or model configuration was present; configure those server variables and run the one-question browser check above. The dev endpoint has no authenticated user and must not be deployed as a user API. It returns one completed answer, with no persistence, streaming, portfolio context, news grounding, citations, or durable cancellation. The source directory is not a Git repository, so no commit was made. The pre-existing Next.js-generated `apps/api/AGENTS.md` and `CLAUDE.md` remain pending approval to remove.

**Documentation follow-up (2026-10-01):** Created the root `README.md` for students. It explains milestone 04's purpose, the actual implementation sequence, observed checks, mock and optional live run commands, and remaining limits. The README was absent in this workspace before the follow-up. Only documentation changed; application checks were not rerun.

## Previous milestone report — 03

**What works:** The React app has Dashboard, Portfolios, News, Assistant, Watchlist, and Settings routes. A sidebar becomes a mobile drawer; the portfolio selector updates summary and holdings. Dashboard cards, holdings table, news, and a clearly disabled assistant preview use deterministic fixture DTOs. Every page visibly labels demo data and a fixed UTC snapshot. The shell has a skip link, named navigation, table semantics, labeled controls, visible focus, responsive layouts, and reusable empty/loading/error/stale state components. The API client validates JSON with a supplied schema and distinguishes HTTP envelope errors, invalid responses, timeouts, cancellation, and network failures. TanStack Query manages the API health query.

**Changed files:** `apps/web/package.json`, `src/main.tsx`, new `src/app.tsx`, `src/styles.css`, `src/data/demo.ts`, `src/lib/api-client.ts`, `src/lib/api-client.test.ts`, `src/lib/format.ts`, `playwright.config.ts`, and `e2e/shell.spec.ts`; `packages/contracts/src/index.ts`; `package-lock.json`; `docs/versions.md`; `docs/lessons/03-ui-shell.md`; this state file. No instruction files were changed.

**Check results:** `npm run build`, `npm run typecheck`, `npm run lint` (the current project script runs TypeScript), `npm run test`, and `npm run check:browser-boundary` passed using the installed Node 24.21.0 executable and npm CLI with its directory prepended to `PATH`. Ten unit tests passed (two contracts, four config, four web API client). With `npm run dev` running, `npm run test:browser --workspace=@portfolio-pilot/web` passed two Chrome tests covering routes, portfolio selection, keyboard Tab/Enter, the mobile drawer and Escape, and no page-wide horizontal overflow at 390 px. Desktop 1440 px and mobile 390 px screenshots were captured and visually inspected. The first browser run failed because a text locator matched three demo labels; the locator was made specific and the final run passed. The first root unit run picked up the Playwright spec; the web Vitest command now scopes to `src`, and the final root run passed. An experiment with Playwright-managed server startup passed the tests but hung at teardown on Windows, so the final test configuration uses the manual `npm run dev` workflow and exits cleanly. Vite emitted non-fatal third-party `use client` directive warnings during the successful build.

**How to demonstrate:** With Node/npm active, run `npm install`, `npm run dev`, then open `http://127.0.0.1:5173/`. Visit all six routes, switch from Growth to Income Portfolio, resize below 850 px to use the drawer, and use Tab/Enter and Escape. Run `npm run test:browser --workspace=@portfolio-pilot/web` to repeat the Chrome smoke test; run `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run check:browser-boundary` for project checks. On this host, invoke npm through `C:\Users\luisc\AppData\Local\Author Software\nvm\installs\v24.21.0\node.exe` and its adjacent `node_modules\npm\bin\npm-cli.js`, with the Node install directory first in `PATH`.

**Remaining limitations:** Portfolio, watchlist, news, and market figures are fixtures, not persisted or live provider data. The Assistant input is disabled until milestone 04. Only the health endpoint uses the API client so far. Browser smoke coverage is limited to installed Chrome at 1440 px and 390 px, not a full accessibility audit or other browser engines. This workspace has no `.git` directory, so no commit was made. Next.js-generated `apps/api/AGENTS.md` and `apps/api/CLAUDE.md` remain from milestone 02 because their removal was rejected by automatic approval review.

**Documentation follow-up (2026-09-30):** Added `README.md` as a beginner-friendly guide to milestone 03, its verified results, run commands, and current limits. This follow-up changed documentation only; no application checks were rerun. A static check confirmed the requested sections and fenced command examples are present.

## Previous milestone report — 02

**What works:** npm workspaces cover the three applications and seven shared packages with explicit exports and ordered shared builds. React/Vite serves on 5173; the Node.js Next Route Handler serves `GET /api/health/live` on 3001 through the Vite `/api` proxy. The route returns a UUID request ID in both the JSON body and `x-request-id` header; invalid server configuration uses the shared error envelope. Browser and server config have separate Zod entry points, with empty example placeholders and mock defaults. The worker reports its role and exits cleanly on its shutdown message. The browser package graph is limited to web, contracts, and config.

**Changed files:** Root `package.json`, `.gitignore`, `tsconfig.base.json`, `package-lock.json`, `scripts/`; new `apps/web`, `apps/api`, `apps/worker`, and `packages/contracts`, `packages/domain`, `packages/db`, `packages/providers`, `packages/agent`, `packages/config`, `packages/observability`; `docs/versions.md`, `docs/lessons/02-monorepo-contracts.md`, and this state file. Next.js generated `apps/api/AGENTS.md` and `apps/api/CLAUDE.md` during the dev smoke check; they remain in the workspace because automatic approval review rejected their removal. `agentRules: false` now prevents regeneration.

**Check results:** Direct Node invocation of the installed npm 11.19.0 CLI ran `npm install --no-audit --no-fund` successfully (295 packages; lockfile created), then `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run test` successfully. The test run has six passing focused contract/config assertions; other workspaces currently have no test files. `npm run check:browser-boundary` passed, and source/built asset scans found no agent SDK, Prisma, Node-only import, or server secret marker in web code. `npm ls` confirmed the approved core versions. `npm run dev` started Vite and Next.js; HTTP checks returned 200 for `/` and `/api/health/live` through port 5173, with matching request IDs. The worker printed its role and a graceful IPC shutdown message, then exited 0. Normal `npm` invocation is blocked by the local NVM trust shim; direct Node + npm CLI invocation works. A separate single-workspace npm build attempt failed intermittently through that shim, while the final root build and typecheck passed.

**How to demonstrate:** In a shell with Node/npm active, run `npm install`, `npm run build`, `npm run typecheck`, `npm run test`, `npm run check:browser-boundary`, then `npm run dev`. Open `http://127.0.0.1:5173/` and `http://127.0.0.1:5173/api/health/live`. For the worker, run `npm run start --workspace=@portfolio-pilot/worker` after build and stop with Ctrl+C. On this host, substitute `& 'C:\Users\luisc\AppData\Local\Author Software\nvm\installs\v24.21.0\node.exe' 'C:\Users\luisc\AppData\Local\Author Software\nvm\installs\v24.21.0\node_modules\npm\bin\npm-cli.js'` for `npm`.

**Remaining limitations:** No browser automation or visual inspection was run; the HTTP and production build checks verify delivery but not browser rendering. The database and agent packages expose boundaries only; their persistence and SDK behavior belong to later milestones. Prisma install scripts were not allowlisted by npm, and no Prisma schema/generation is needed until milestone 06. This directory is still not a Git repository, so no commit was made. Automatic approval review rejected removing Next.js-generated `apps/api/AGENTS.md` and `apps/api/CLAUDE.md`, citing the contract's protection of instruction files; removal requires explicit user approval.

## Previous milestone report — 01

**What works:** A stable, exact dependency version set and Node 24.21.0 LTS/npm 11.19.0 baseline are documented in `docs/versions.md`, with official compatibility references. Root metadata pins the runtime and package manager. `.gitignore` excludes credentials, SDK transcripts, generated output, and local database files.

**Changed files:** `.nvmrc`, `.npmrc`, `package.json`, `.gitignore`, `docs/versions.md`, `docs/lessons/01-toolchain.md`, and this state file. No application code or packages were installed.

**Check results:** `git --version` passed (2.52.0.windows.1); `docker --version` passed (28.5.2); `docker compose version` passed (2.40.3); `nvm list` found 24.21.0 installed. `node --version` and `npm --version` failed because no active Node version is configured. `docker info --format '{{.ServerVersion}}'` failed with access denied to the Docker config/engine pipe. `git status --short` failed because this directory is not a Git repository. Direct PowerShell request to `https://registry.npmjs.org/react/latest` failed to connect; registry package pages and official docs were reviewed through web access. `Get-Content package.json -Raw | ConvertFrom-Json` passed, confirming valid JSON and the selected engine/package manager fields. Static checks found the intended `.gitignore` exclusions and both new docs; `package-lock.json` does not exist. A local install, lockfile resolution, build, and tests were not run.

**How to demonstrate:** Review `docs/versions.md`, `.nvmrc`, `.npmrc`, `package.json`, and `.gitignore`. In Windows PowerShell, run `nvm use 24.21.0; node --version; npm --version`. In Linux/WSL2 with `nvm-sh`, run `nvm install 24.21.0 && nvm use 24.21.0 && node --version && npm --version`. After milestone 02 creates workspace manifests and network access works, run `npm install --package-lock-only --ignore-scripts`, `npm install`, and the `npm ls ...` command in `docs/versions.md`.

**Remaining limitations:** This shell cannot currently activate Node/npm, access the npm registry directly, use the Docker engine, or inspect Git history. SDK installed types and full resolved peer graph must be checked when dependencies are installed. There is no lockfile because no dependency manifests or install exist yet. Docker and credentials are unnecessary for milestone 01.

## Previous milestone report — 00

**What works:** The project contract, assistant pointer file, 36-milestone plan, state tracker, and
ADR index exist. No application code has been generated.

**Changed files (all new):**
- `AGENTS.md`, `CLAUDE.md`
- `docs/project-plan.md`, `docs/project-state.md`
- `docs/decisions/README.md`, `docs/decisions/0001-architecture-baseline.md`
- `docs/lessons/00-project-contract.md`
- `README.md` (added after the milestone at the user's request; a student-facing explanation of
  Prompt 00. Milestone 36 replaces it with the full application README.)

**Check results:** Documentation-only milestone; no build, lint, or test tooling exists yet.
Verified that the workspace was empty beforehand, so no existing instruction files were overwritten.

**How to demonstrate:** Open `AGENTS.md`, then `docs/project-plan.md`. Start a fresh assistant
session and confirm it reads `CLAUDE.md` ? `AGENTS.md` ? `docs/project-state.md`.

**Remaining limitations:**
- ~~The folder is not a git repository.~~ Resolved: the user initialized the repository and added
  the GitHub remote; the Milestone 00 docs and README were committed and pushed to `main` on request.
- No versions are pinned yet; that is milestone 01.

## Open decisions and blockers

- Better Auth database/session model is chosen in ADR 0002; its maintained version and integration are verified in 07. Live quote/news provider and gateway controller are decided in their
  milestones (07, 12, 35) and recorded as ADRs.





