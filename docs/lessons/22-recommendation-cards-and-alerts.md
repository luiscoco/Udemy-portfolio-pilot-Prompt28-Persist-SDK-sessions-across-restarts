# 22 — Recommendation cards and configurable alerts

## Teaching goal

Follow a relevant fixture through ingestion, private research, a PostgreSQL alert decision, the
transactional outbox and SSE. Explain why repeated transport delivery is not a new recommendation.
Browser reads recover stored truth; they do not generate analysis to fill an empty view.

## What changed

- Research & alerts navigation and `/research`: affected holdings/watchlist securities, proposed
  research action, safe cited evidence, source publication timestamps, as-of, caveats and expandable
  explanation. News detail uses the same cards. Save, unsave, dismiss and restore persist by owner.
- Open/saved/history reads keep disposition separate from active/stale/superseded evidence state.
- Alert rule CRUD: enabled, categories, current-interest security IDs, concentration/relevance
  fractions and cooldown seconds. Rules are user-configured; the agent cannot change them.
- Stored notifications, persistent dismissal, owner-only outbox/SSE invalidation and recovery.
- Inclusive decimal threshold comparisons; user/rule revision/article revision uniqueness and
  durable cooldown suppression. Rule edits do not erase cooldown or notification history.
- Development fixture now describes fictional guidance changes so the mock can demonstrate a
  material research action. `development-fixture` is an explicitly supported synthetic evidence
  provider. These events are invented teaching material.

See [ADR 0015](../decisions/0015-durable-in-app-alerts.md) for filter semantics and delivery policy.

## Demonstration (PowerShell)

Use the retained, dedicated local `portfolio_m22_verify` database and Redis. Existing infrastructure
setup is described in lesson 05. Run from the workspace root:

```powershell
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m22_verify'
$env:REDIS_URL='redis://127.0.0.1:6379'
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:NODE_ENV='development'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
$env:AUTH_SECRET='local-session-verification-secret-only-1234567890'
$env:ALLOW_DEMO_SEED='true'
npm run build:types
npm run build -w @portfolio-pilot/worker
npm run migrate:deploy -w @portfolio-pilot/db
npm run seed:demo -w @portfolio-pilot/db
npm run dev
```

In a second terminal with the same server environment, run the outbox role:

```powershell
$env:WORKER_ROLE='outbox'
npm run start -w @portfolio-pilot/worker
```

1. Open `http://127.0.0.1:5173`, sign in as Alice Demo, and add NOVA / XNAS to the
   watchlist if it is not already present. Open **Research & alerts**.
2. Create a rule named `NOVA research`, select NOVA, leave categories and numeric thresholds empty,
   and set cooldown to `0` for the duplicate-delivery demonstration. Numeric thresholds can instead
   be set to e.g. `0.2` when demonstrating a held security (not watchlist-only null exposure).
3. In a third terminal with the same development/mock/database environment, inject twice:

```powershell
npm run news:inject -w @portfolio-pilot/worker -- lesson22 1
npm run news:inject -w @portfolio-pilot/worker -- lesson22 1
```

4. One notification appears for the rule revision. The research cards show source publication
   time, labeled exposure basis and caveats. Expand/collapse the explanation, save a card, dismiss
   another, and dismiss the alert. Reload and select **History including dismissed**: the actions persist.
5. Disconnect the browser network, inject a *new fixture ID*, restore connectivity and verify the
   notification appears once. Reconnecting replays SSE or refetches PostgreSQL snapshots.
6. Sign in as Bob in a separate browser profile: Alice's alert rule, notifications and private
   recommendation IDs are absent. For correction/cooldown demonstration, inject `lesson22 2`.
   With a 300-second cooldown, the correction decision is stored as suppressed until a future new event.
7. A fresh account or empty saved view has an explicit empty state; reading it does not run analysis.

This session's nvm npm shim refused package-manager execution (`NVM4306`). The exact commands above
were executed using the installed CLI instead; for this machine replace `npm` with:

```powershell
$npmCli='C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0/node_modules/npm/bin/npm-cli.js'
node $npmCli run typecheck
```

No nvm configuration was changed. If running directly within a workspace encounters the inactive
node shim, use the installed executable
`C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0/node.exe`.

## Automated acceptance and actual results

```powershell
$env:ALERT_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m22_verify'
npm run test -w @portfolio-pilot/api -- lib/alerts.integration.test.ts
$env:ALERT_E2E_DATABASE_URL=$env:ALERT_TEST_DATABASE_URL
npm run test:browser -w @portfolio-pilot/web -- alerts.spec.ts --workers=1
```

On 2026-10-02: all four real PostgreSQL/Redis/API acceptance tests passed. Chrome E2E passed
1/1 with offline fixture injection, recovery, one stored notification, save/dismiss/reload,
expand/collapse, Bob isolation and 390px layout. Screenshot `apps/web/test-results/alerts-mobile.png`
was visually reviewed. The complete suite with `ALERT_TEST_DATABASE_URL` passed 251 tests;
68 unrelated opt-in infrastructure tests skipped. `typecheck`, production `build` and browser
dependency boundary checks passed. All 13 migrations applied locally. Schema diff has no remaining
milestone-22 drift; it still reports pre-existing NewsRead update actions and the intentional
SQL-only recommendation GIN index. No diff SQL was applied.

## Limitations

Live Claude behavior/latency is unverified because credentials are absent. To check it, configure
`ANTHROPIC_API_KEY`, `AGENT_MODE=claude`, `AGENT_MODEL_ID`, `AGENT_WORKSPACE_DIR` server-side and
run `npm run dev` plus the outbox worker on a supported real article. Do not use invented fixture
content as investment evidence. Category classification is model-dependent; numeric decisions are not.
History reads are bounded (latest 50 recommendations / 100 notifications); rows remain durable.
News triggers evaluation, not quote updates. Long model runs share dispatcher leases/retry budgets;
DEAD events require operator requeue after the cause is fixed (durable agent work remains milestone 27).
Existing Vite directive/large-chunk and three Next instrumentation Edge warnings remain. Docker CLI
access was denied, but direct PostgreSQL/Redis connections allowed all acceptance checks.
