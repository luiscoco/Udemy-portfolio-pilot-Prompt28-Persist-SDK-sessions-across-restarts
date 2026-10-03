# 26. Manage context and enforce usage budgets

## What works

Interactive assistant runs have validated server settings for model, current prompt bytes, serialized
tool-result bytes, main turns, wall time, estimated run cost, overflow reservation, per-user daily
allowance and context-reset interval. The live adapter uses supported SDK options and application
guards. Structured retries share the run's remaining limits. A stalled dependency reaches a durable
terminal outcome, and budget rejection creates no draft/run/message. Timeout/cancellation/limit
messages resolve SSE and polling, leaving the composer usable.

Each accepted run reserves its estimated maximum plus overflow on the authenticated owner's
database UTC day, atomically with the run and user message. Concurrent replicas cannot exceed
charged + reserved allowance. Completion moves the reservation to measured SDK estimated cost,
or zero for mock mode, once. Known overruns consume their actual reported estimate. Missing/crash
telemetry retains the full reservation conservatively; a reservation is not refunded after a process
dies. It still counts while outstanding, and stale-run access/reconciliation moves it to charged
uncertain usage with a visible interrupted message. Paid retries stop if prior usage is uncertain.

Money accounting uses decimal parsing and exact integer microdollars/PostgreSQL numeric, with
upward rounding for SDK estimates and reservations. SDK options alone accept numeric USD. Cost
estimates are not invoices. modelUsage supplies aggregate tokens including subagents; partial
messages and child totals are not added to that aggregate. Callback/result duplicate reports replace
one another. Store the actual model reported by the main assistant message (init model as fallback).
Costs/tokens/model are saved with the run and assistant message for reload recovery.

Context resets explicitly start a new session with an application summary. The application walks
all saved message pages, keeps exact historical user requests (including requested portfolio scopes)
and every validated source URL/ID/publication timestamp/synthetic label, and bounds recent analysis
excerpts. It labels old analysis, omitted/excerpted turns and fresh-data reread requirements. Current
request and stored portfolio scope remain intact. Too-large summaries or truncated full-portfolio
lookups fail visibly, instead of answering a smaller question. History scanning has an explicit
1,000-message safety boundary; the full saved chat remains in PostgreSQL.

## Configuration

| Server variable | Default | Meaning |
| --- | --- | --- |
| AGENT_MODEL_ID | required in Claude mode | Operator-selected model identifier; no browser/model input override |
| AGENT_MAX_PROMPT_BYTES | 48000 | UTF-8 current request/context plus live system instruction; tool schemas/SDK-internal resumed transcript are managed separately by the SDK |
| AGENT_MAX_TOOL_RESULT_BYTES | 24000 | Serialized MCP result bytes, including duplicate text/structured JSON |
| AGENT_MAX_TURNS | 6 | Main SDK round trips across attempts; mock simulates reads plus answer |
| AGENT_WALL_CLOCK_MS | 90000 | Whole run, including context preparation and approval waiting |
| AGENT_MAX_COST_USD | 0.10 | Whole interactive run SDK cost estimate cap |
| AGENT_COST_OVERFLOW_USD | 0.10 | Additional daily reservation for the response crossing the SDK cap |
| AGENT_DAILY_BUDGET_USD | 2.00 | Charged plus reserved quota on the DB UTC day |
| AGENT_CONTEXT_RESET_TURNS | 8 | Start a summary-seeded session periodically at binding-generation boundaries |

SDK 0.3.276 / bundled CLI 2.1.276 reports per-query estimates even on resume. Current official
documentation dates restored session totals to CLI 2.1.277. An unexpected live runtime version on
resume fails closed; future upgrades must add verified baseline/delta accounting before enabling
that changed lifecycle. Per-message output token fields may be placeholders and are used only for
an early resource guard, never charged usage. See [ADR 0019](../decisions/0019-agent-limits-and-daily-reservations.md).

## Changed files

Created `packages/db/src/agent-budget.ts`, migration
`packages/db/prisma/migrations/20261013100000_agent_budgets/migration.sql`,
`apps/api/lib/agent-budget-money.ts`, its test, `apps/api/lib/budgets.integration.test.ts`,
`packages/agent/test/limits.test.ts`, `apps/web/e2e/budgets.spec.ts`, ADR 0019 and this lesson.

Modified `packages/config/src/server.ts`; `packages/contracts/src/{index,chat,agent-events}.ts`;
`packages/db/prisma/schema.prisma`, `src/{chat-service,portfolio-service}.ts`;
`packages/agent/src/{index,streaming,delegation,research-context,mock-portfolio-agent}.ts`,
`src/tools/{context,portfolio-tools}.ts`, existing streaming/session fixture assertions;
`apps/api/.env.example`, `lib/{chat,chat-coordinator,http,portfolio-http}.ts`;
`apps/web/src/chat.tsx`, project state, versions and ADR index. Generated Prisma/build outputs
and local test reports refreshed. No dependencies upgraded, source files removed, instruction files
overwritten, commit, push, paid resource provisioning or public deployment.

## Check results (2026-10-03)

- Offline installation passed: `npm ci --ignore-scripts --offline --cache .npm-cache`,
  348 packages, zero vulnerabilities. The NVM npm shim was blocked; checks used the installed
  Node 24.21.0 / adjacent npm-cli.js with the installed directory first on PATH.
- All fifteen migrations applied to fresh `portfolio_m26_verify` on existing PostgreSQL port 5546.
  Prisma generation initially hit the existing cache EPERM; an existing cached schema engine
  supplied by PRISMA_SCHEMA_ENGINE_BINARY generated successfully. Migration execution needed
  a workspace copy with `.exe` suffix (the extensionless Windows cache file could not execute).
- `npm run typecheck`, `npm run lint`, `npm run build` and
  `npm run check:browser-boundary` passed. Build retains existing Vite directives/large-bundle and
  three Next instrumentation Edge warnings. Final database compile and focused acceptance passed
  after aligning conversation/day lock ordering. Final web compile follows budget error wording.
- Workspace credential-free suite passed **282 tests**, **99 opt-in skipped** at that run.
  New decimal conversion test and three extra DB acceptance cases were added afterwards and
  verified in the focused suite. Final agent suite: **133 passed**, **2 live tests skipped**.
  Final mock result-size/parallel-turn enforcement compiled and its limits/delegation/approval
  regression selection passed **27/27**.
- Final PostgreSQL budgets + coordinator + exact-money suite: **17/17 passed**. Includes twelve
  concurrent reservations under $0.60 (exactly three accepted), rollback/no orphan message,
  foreign ownership, exactly-once completion, conservative crash/cancellation, stalled-stream
  timeout, prompt/tool/turn limits, overrun reconciliation, shared retry caps, uncertain-retry stop,
  truncated-scope refusal and source-preserving context reset.
- Chrome E2E: **1/1 passed** against actual API/Vite/PostgreSQL/Redis. Selected scope stayed
  unchanged; second turn reset context; waiting approval timed out; explicit cancellation remained
  usable; budget exhaustion returned HTTP 429 with no hanging draft and enabled composer.
  The initial test used the wrong demo email; it was corrected to the seed's documented user ID.
- Temporary API/Vite processes were stopped; HTTP checks confirmed ports 3001 and 5173 stopped.
  Dedicated test database remains available for inspection. Workspace is not a Git repository.

## Demonstration

Run from the repository root in PowerShell with Node/npm active. Public local fixture credentials
below are only for this dedicated local test database. Start the existing local PostgreSQL/Redis
services if needed (`npm run infra:start`); create the dedicated DB if it does not already exist:

```powershell
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d postgres -c 'CREATE DATABASE portfolio_m26_verify;'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m26_verify'
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run build:types
npm run migrate:deploy --workspace @portfolio-pilot/db
npm run seed:demo --workspace @portfolio-pilot/db
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
$env:AUTH_SECRET='local-budget-verification-secret-1234567890'
$env:REDIS_URL='redis://127.0.0.1:6379'
$env:AGENT_MOCK_STREAM_DELAY_MS='0'
$env:AGENT_CONTEXT_RESET_TURNS='1'
$env:AGENT_WALL_CLOCK_MS='3000'
npm run dev
```

In a second PowerShell window:

```powershell
$env:BUDGET_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m26_verify'
npm run test --workspace @portfolio-pilot/api -- lib/budgets.integration.test.ts lib/chat-coordinator.test.ts lib/agent-budget-money.test.ts
$env:BUDGET_E2E_DATABASE_URL=$env:BUDGET_TEST_DATABASE_URL
npm run test:browser --workspace @portfolio-pilot/web -- budgets.spec.ts --workers=1
npm run test --workspace @portfolio-pilot/agent
```

Open http://127.0.0.1:5173/assistant, sign in as Alice Demo, select Growth and create a
conversation. Ask `What do I own?` twice. The second answer explains context reset, preserves
Growth scope and labels mock zero-cost usage. Send `Add ACME on XNYS to my watchlist` and leave
approval pending: the run stops at its three-second limit. Repeat and click Cancel answer promptly.
The browser test creates its own unused security and injects/restores an exhausted test ledger to
demonstrate daily rejection. The DB acceptance test demonstrates concurrent reservations directly
without relying on browser timing. To demonstrate a prompt limit, restart with
AGENT_MAX_PROMPT_BYTES=256 and send a 1,000-character request; restore defaults afterward.

If Windows's extensionless cached Prisma engine cannot execute, use the observed local workaround:

```powershell
New-Item -ItemType Directory -Path .cache/prisma -Force | Out-Null
Copy-Item -LiteralPath "$env:APPDATA/Prisma/master/0edf323efd1d98336f3f0a68684b56f689b900d3/windows/schema-engine" -Destination '.cache/prisma/schema-engine.exe'
$env:PRISMA_SCHEMA_ENGINE_BINARY=(Resolve-Path '.cache/prisma/schema-engine.exe').Path
```

If the NVM shim is blocked, put its existing installed directory on PATH and invoke its npm-cli.js
through node, as in prior milestone lessons. No user-level NVM configuration was changed.

## Remaining limitations and exercise

No live Claude model was called: credentials were not available. To verify live behavior, set
AGENT_MODE=claude, ANTHROPIC_API_KEY, operator-chosen AGENT_MODEL_ID and the existing required
isolated AGENT_WORKSPACE_DIR; run `npm run dev`, then repeat a focused question, follow-up,
low-turn run and cancellation. Inspect owner-authorized `GET /api/runs/{runId}` and its persisted
estimated usage/model. Authoritative billed usage requires Anthropic's separate Usage and Cost API.
SDK threshold/overflow allowance cannot guarantee an invoice ceiling, and conservative crash
charges may overstate a day's quota use. This milestone covers the interactive AgentRun tree;
separately cached shared public article analysis keeps its existing service-level limits.
Durable workers, cross-host session artifacts and multi-replica run recovery remain 27/28/30.

Exercise: explain why charging a query result **and** its partial/child messages double-counts,
and why releasing a crashed run's reservation without trustworthy final telemetry admits extra
unaccounted spend. Repeat the twelve-request reservation test with a smaller daily allowance.
