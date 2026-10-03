# 27 - Move execution into a durable worker

## What works

An authenticated POST reserves the daily budget and saves a queued job/user message. The API only
submits, inspects, cancels, decides approvals and serves SSE/recovery. A separately selected agent
worker runs the existing mock/Claude adapter, authorized tools, context/session logic and budgets.
API restarts preserve active answers and waiting approvals. Duplicate replicas cannot claim one
attempt. Worker crashes produce a deliberately recoverable interrupted answer rather than an
unsafe automatic replay. Read [ADR 0020](../decisions/0020-durable-agent-jobs.md) for the invariants.

Persisted fields distinguish job attempt from SDK attempts: queued/running/waiting_for_approval/
completed/failed/cancelled, lease owner/expiry, heartbeat, execution-start marker and cancellation
request. Conversation leases serialize turns. Result/progress/session/mutation fences reject old
attempts even after another claim. A never-started claim can retry at most three times. A begun
query requires an explicit new request after interruption. Consumed approvals stay saved; pending
or unconsumed grants are invalidated. Before query invocation, cancellation records not_started
usage and zero cost, including live-mode jobs. Uncertain cost conservatively consumes its reservation.

The visible journal coalesces bounded text batches, retains sequences in PostgreSQL and commits
each batch with its outbox event. Terminal message and events commit atomically. Browser reload
and Redis retention gaps recover the journal through an owner-scoped endpoint; final text replaces
the draft exactly once. No raw SDK messages, hidden reasoning, tool arguments or credentials enter
the journal or SSE.

## Changed files

Created DB agent-jobs, run-lease and run-progress modules, AgentRunChunk/schema migration;
worker agent loop/execution/event batching/money modules and PostgreSQL acceptance suite;
API chunks route and explicit test worker harness; browser worker E2E and two local verifier scripts;
ADR 0020 and this lesson. Modified DB chat/approval/repository exports and contracts, worker role/env example, cache ignore, API submission/cancellation/inspection/approval routes, browser recovery/store and tests,
previous chat/session/approval/budget regression fixtures, ADR index and project state. The local
coordinator moved into historical test fixtures; its API runtime file and API event publisher were
removed. Generated Prisma/build artifacts refreshed. No instructions changed, dependency upgrades,
commits, pushes, public deployment or cloud resources.

## Check results

Build, typecheck, lint, default tests and browser boundary passed. Final default suite: 285 passed,
110 opt-in skipped. PostgreSQL jobs: 8/8; budget/approval/session/chat: 13/13, 13/13, 10/10, 8/8.
Actual HTTP restart verifier passed; Chrome: 1/1 passed. Prisma drift inspection reports older
FK/GIN differences (exit 2), with no new job/chunk drift. Full results, initial failures and
corrections are recorded in project-state.md. Local installation used
`npm ci --ignore-scripts --offline --cache .npm-cache`: 348 packages, zero vulnerabilities.
NVM's normal npm shim initially rejected its delegated entrypoint. Checks used installed Node
24.21.0/npm 11.19.0 with the Node install directory first on PATH. Prisma generation initially
failed with cache EPERM; an existing cached schema engine copied into .cache/prisma worked.
Docker read/create commands required the sandbox's approved escalation; local PostgreSQL/Redis
were available. Sixteen migrations applied to a fresh dedicated local test database. During
implementation the new migration was placed after the budget migration and its FK aligned with
Prisma's ON UPDATE CASCADE; only this disposable verification DB's new migration metadata was
aligned. No deployed/application migration history was edited.

## Demonstration

Use existing local infrastructure and public fixture credentials only in development/test:

```powershell
npm run infra:start
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d postgres -c 'CREATE DATABASE portfolio_m27_verify;'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m27_verify'
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run build
npm run migrate:deploy --workspace=@portfolio-pilot/db
npm run seed:demo --workspace=@portfolio-pilot/db
$env:AGENT_JOBS_TEST_DATABASE_URL=$env:DATABASE_URL
npm run test --workspace=@portfolio-pilot/worker -- test/agent-jobs.integration.test.ts
node scripts/verify-agent-worker.mjs
node scripts/verify-agent-browser.mjs
```

The process verifier binds the compiled API to loopback port 5301, restarts it during a real mock
answer and waiting approval, tests remote cancellation, kills a worker, fast-forwards only that
fixture's lease, and checks interruption/unused grant invalidation. It runs outbox delivery and
checks authenticated SSE and persisted published progress. The browser verifier temporarily uses
ports 3001/5173 and installed Chrome. Do not run these verifiers concurrently with each other or
other demo-user acceptance suites. They stop their own servers/workers; local DB fixtures remain.

For an interactive demo, copy apps/api/.env.example to apps/api/.env.local and set its local
DATABASE_URL, REDIS_URL, DATA_MODE=mock, AGENT_MODE=mock, DEMO_AUTH_ENABLED=true and stable
AUTH_SECRET. Run `npm run dev`, then in separate terminals from the repository root:

```powershell
$env:WORKER_ROLE='agent'
node --env-file=apps/api/.env.local apps/worker/dist/index.js
# Another terminal, same environment file:
$env:WORKER_ROLE='outbox'
node --env-file=apps/api/.env.local apps/worker/dist/index.js
```

Visit /assistant, sign in as Alice, create a conversation and send a question. Stop/restart only
the API while the worker answers; refresh to recover progress. Ask to add a new known USD stock
to the watchlist, restart the API while its approval card waits, then approve or cancel. Run two
agent terminals to demonstrate disjoint claims. Kill a worker during an answer; after its 30s lease
expires, an available worker marks it interrupted. Send a new request to deliberately continue.
With agent workers stopped, jobs remain queued and may still be cancelled without model cost.
Without the outbox role, polling/journal recovery works but SSE progress delivery is delayed.

If NVM/Prisma cache restrictions recur, use the installed npm-cli.js and the existing cached
schema-engine copy workflow from lesson 26; PRISMA_SCHEMA_ENGINE_BINARY must point to the
workspace .cache/prisma/schema-engine.exe. No user-level installation changes are necessary.

## Remaining limitations

Live Claude remains unverified without application credentials: configure the existing
ANTHROPIC_API_KEY, operator-selected model and isolated AGENT_WORKSPACE_DIR **on the worker**,
set AGENT_MODE=claude on server configuration, and repeat a focused interactive answer/approval/
cancellation. Session artifacts are host-local until milestone 28; another worker honestly seeds
history rather than claiming portable continuation. A worker processes one run at a time. Fleet
concurrency, admin recovery, retention and monitoring remain milestone 30. Recovery requires an
available worker/database; leases cannot immediately terminate an external provider during a
partition, but prevent stale writes and application mutations. The existing unrelated Prisma
drift in older approval/news-read FKs and the recommendation GIN index is documented in state.

## Student README follow-up (2026-10-03)

Created the missing [root README](../../README.md) with beginner-friendly purpose, implementation
steps, results, demo commands, isolated verification and limitations. Recorded milestone checks
are labeled as historical; the alternative Compose test-database recipe was not executed during
this update. Static PowerShell validation passed for six required headings, 18 balanced fence
markers, 10 existing local link targets and referenced root npm scripts. Application checks were
not rerun. This follow-up changed only README, project state and this lesson note.

Exercise: kill a worker before and after its execution-start marker. Explain why only the first
case can replay safely, and why fencing must cover approval consumption and session binding as
well as the final assistant message.
