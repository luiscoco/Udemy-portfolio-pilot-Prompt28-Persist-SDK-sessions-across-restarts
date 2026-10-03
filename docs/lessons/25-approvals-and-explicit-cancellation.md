# Milestone 25 - Approvals and explicit cancellation

## What works

The assistant can propose `watchlist.add` (exchange-aware symbol) and `alert.update` (owned
rule ID, expected revision and complete replacement settings). Model text never authorizes a
write. The owner-bound application persists exact schema-normalized arguments, action, SHA-256
hash, run, expiry, prior state and unique mutation ID in ApprovalRequest. Cards show the current
state and exact proposed change. Approval/rejection use cookie authentication, origin validation,
bounded JSON and the displayed hash. Expired, foreign, changed and cancelled requests cannot write.

The SDK PreToolUse hook asks; documented canUseTool waits for the endpoint decision and returns
the validated input. The write handler requires the same application receipt and independently
rechecks everything. Mutation, consumption and outbox insertion commit together; duplicate
consumption returns the stored UUID without executing again. Alert revisions and watchlist state
are checked both at approval and use. Cancellation serializes with writes on the run row, invalidates
pending/granted approvals, aborts the Query and persists an honest terminal message. Disconnects
and reloads never cancel. Previously committed approved changes remain saved.

The SDK callback is process-local. Lost waiting runs fail safely on reconciliation/approval access;
records remain in PostgreSQL. The user explicitly sends a new proposal to start a controlled new
run with a new approval. No session ID or restart can authorize replay of a pending write.

## Changed files

Created contracts/approvals.ts; DB approval-service.ts and 20261010090000_approvals migration;
agent approval-tools.ts and approvals.test.ts; API approval approve/reject and run approvals routes;
API approvals.integration.test.ts; web approvals.spec.ts; ADR 0018 and these notes.
Modified contract exports/run status, Prisma schema/DB exports/chat-service, agent tool context,
MCP registration, permission/policy/delegation composition, mock/live adapters and instructions;
API authorization/chat/run composition; web chat/card styles; versions, ADR index and project state.
Generated Prisma/client/workspace/build artifacts refreshed. No source files removed.

## Checks actually run (2026-10-02)

- Offline installation: `npm ci --ignore-scripts --offline --cache .npm-cache`: 348 packages,
  zero vulnerabilities. The NVM shim refused npm; the installed node.exe/npm-cli.js entry points
  restored dependencies without changing tool versions or trust settings.
- `npm run build:types` and `npm run typecheck`: passed all workspaces. Prisma's first sandboxed
  cache access failed EPERM; an approved local generation succeeded. Subsequent checks passed.
- Fresh `portfolio_m25_verify` on localhost:5546: all fourteen `prisma migrate deploy` migrations
  applied, including active/waiting uniqueness and status/terminal constraints.
- `DATA_MODE=mock npm run test`: 276 passed, 88 opt-in tests skipped. Agent permission integration
  adds three passing tests. The observability package has no tests. The executing-cancellation test
  was added afterwards and passed in the focused database suite.
- `APPROVAL_TEST_DATABASE_URL=.../portfolio_m25_verify vitest run lib/approvals.integration.test.ts
  lib/chat-coordinator.test.ts` (API cwd): 16 passed. Final approval-only rerun after expiry-on-read:
  13 passed. Covers approve/reject, pending/granted expiry, concurrent double-click/consume,
  canonical argument binding/changed arguments, foreign approval/run/rule IDs, anonymous/forged
  origins, watchlist state, alert revision changes, waiting/executing cancellation, cancel/use race,
  lost callback/new confirmation and the real authenticated mock endpoint flow.
- `APPROVAL_E2E_DATABASE_URL=.../portfolio_m25_verify playwright test approvals.spec.ts --workers=1`
  (web cwd): 1 passed in Chrome. Exact proposal, no write before approval, reload recovery, Bob's
  404, approve/reject/cancel and 390px layout. Initial assertions were corrected to wait for Bob's
  authenticated session and to fill the empty composer before expecting Send to be enabled.
- `npm run build`: passed all workspaces. Existing Vite use-client warnings, a >500KB bundle
  warning, and three Next instrumentation Edge warnings remain. Final DB compile/API typecheck
  passed after expiry-on-read; web compile passed after the waiting-status copy change.
- `node scripts/check-browser-boundary.mjs`: passed. Git reports this directory is not a repository.

## Demonstration

Use PowerShell from the repository root. The example database credentials below are public local
fixtures. Do not use them in production. If the NVM shim is inactive, put the trusted installed
Node 24.21.0 directory at the front of this shell's PATH; no NVM configuration change is required.

```powershell
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m25_verify'
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
npm run migrate:deploy --workspace @portfolio-pilot/db
npm run seed:demo --workspace @portfolio-pilot/db
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
$env:AUTH_SECRET='local-approval-demo-secret-only-1234567890'
$env:REDIS_URL='redis://127.0.0.1:6379'
npm run dev
```

1. Open http://127.0.0.1:5173/assistant, sign in as Alice Demo, create a conversation.
2. Send `Add ACME on XNYS to my watchlist`. Inspect the exact symbol/exchange and absent-watchlist
   snapshot. Reload: the card returns and the run is still waiting. Click Approve change within
   60 seconds, then inspect Watchlist. The security appears once.
3. For a second unused stock, use `Add ACME on XNAS to my watchlist`, then Reject change or
   Cancel answer. No pending write occurs. Leaving the first card for 60 seconds expires it.
4. For alert changes, first create a rule in Alerts. Live mode can read listAlertRules and propose
   the replacement. The deterministic mock accepts `Propose change: {JSON}`. To prepare a mock
   prompt from your own current rule, run this in this site's browser developer console:

```javascript
const { rules } = await fetch('/api/alerts/rules').then(r => r.json());
const { id, revision, createdAt, ...rule } = rules[0];
copy('Propose change: ' + JSON.stringify({ actionType: 'alert.update', arguments: {
  ruleId: id, expectedRevision: revision, rule: { ...rule, cooldownSeconds: 180 }
}}));
```

Paste the copied prompt into the assistant, inspect the full replacement and approve. Editing the
rule manually while its card waits invalidates the old proposal. Restarting the API while waiting
fails that run when you refresh/use its approval; sending the proposal again requires new approval.

Acceptance commands (existing loopback DB required):

```powershell
$env:APPROVAL_TEST_DATABASE_URL=$env:DATABASE_URL
npm run test --workspace @portfolio-pilot/api -- lib/approvals.integration.test.ts lib/chat-coordinator.test.ts
$env:APPROVAL_E2E_DATABASE_URL=$env:DATABASE_URL
npm run test:browser --workspace @portfolio-pilot/web -- approvals.spec.ts --workers=1
```

## Limitations and teaching exercise

Live Claude generation/interactive permission behavior was not called: no credentials were used.
To verify it, configure the existing documented AGENT_MODE=claude, ANTHROPIC_API_KEY,
AGENT_MODEL_ID and isolated AGENT_WORKSPACE_DIR, run `npm run dev`, then repeat steps 1-4
with a bounded live request. Installed API/type tests and mock behavior are verified separately.
Multi-replica routing, durable workers and restored session artifacts remain milestones 27/28/30.
Approval expires after 60 seconds and runs retain existing wall-clock bounds. Only watchlist additions
and full alert replacements are authorized actions; the assistant never executes trades.

Exercise: change an approved alert rule before its handler consumes the grant, and explain why
its revision and exact argument hash prevent reuse. Approval is a one-time capability for a specific
run/action/state, never a general permission installed by the model.
