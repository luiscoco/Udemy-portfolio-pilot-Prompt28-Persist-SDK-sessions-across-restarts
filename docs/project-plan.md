# PortfolioPilot — Project Plan

Thirty-six implementation milestones, executed one at a time in order. Each milestone follows the
workflow and completion-report format in [AGENTS.md](../AGENTS.md). Progress and actual check
results are tracked in [project-state.md](project-state.md), not here.

Legend for acceptance: **must** items block completion. Anything that cannot be verified locally
(missing Docker, credentials, cloud access) is recorded as *unverified* with the exact next command.

## Phase overview

| Phase | Milestones | Theme | Course lessons |
| --- | --- | --- | --- |
| 0 | 00 | Project contract and plan | 1–6 |
| A | 01–04 | Setup and first working AI slice | 1–12 |
| B | 05–10 | Database, authentication, portfolios | 13–24 |
| C | 11–12 | Market data and news ingestion | 25–30 |
| D | 13–16 | Redis, durable events, SSE, live news | 31–36 |
| E | 17–22 | Tools, sessions, chat, recommendations, alerts | 37–48 |
| F | 23–26 | Advanced Claude Agent SDK features | 49–54 |
| G | 27–30 | Background execution and production boundaries | 55–60 |
| H | 31–32 | Testing, evaluation, observability | 61–66 |
| I | 33–36 | Containers, Azure infrastructure, AKS, capstone | 67–72 |

Milestone 00 (this contract and plan) precedes the 36 implementation milestones.

---

## Phase A — Setup and the first working application

### 01 · Verify versions and prerequisites
- Inspect node, npm, git, Docker, and the workspace.
- Resolve a mutually compatible **stable** version set from registry metadata and official docs:
  React 19.3+ / react-dom, Vite, TypeScript, Next.js, Prisma + @prisma/client,
  @anthropic-ai/claude-agent-sdk, Zod, Vitest, Playwright. Check engine requirements and peer deps.
- Select a supported Node.js LTS release. Create `docs/versions.md` (versions, rationale, date, references).
- Add version metadata and `.gitignore` (excluding `.env*`, SDK transcripts, build output, DB volumes).
- Document Windows PowerShell vs Linux/WSL2 command differences.
- **Accept:** documented compatibility basis, no invented versions, no prerelease installed silently, secrets excluded.

### 02 · Scaffold the monorepo and shared contracts
- npm workspaces for all apps and packages; strict TypeScript; explicit package exports; correct build order.
- Web on 5173, API on 3001, Vite proxy for `/api`; `GET /api/health/live`; worker reports its role and exits cleanly.
- Root scripts: dev, build, typecheck, lint, test (cross-platform orchestration).
- Validated server/browser config schemas; `.env.example` files with empty placeholders; `VITE_` = public only.
- Error envelope and request correlation ID contract.
- **Accept:** install, web loads, health via proxy, typecheck/build pass; web dependency graph has no SDK/Prisma/Node-only modules.

### 03 · Build the accessible frontend shell
- React Router routes: Dashboard, Portfolios, News, Assistant, Watchlist, Settings.
- Sidebar, mobile nav, portfolio selector, summary cards, holdings table, news and chat panels.
- Typed API client (JSON errors, timeouts, cancellation); TanStack Query (or equivalent) for server state.
- Labeled demo fixtures kept out of presentation components; reusable empty/loading/error/stale states.
- `docs/lessons/03-ui-shell.md`.
- **Accept:** desktop/mobile layout and keyboard navigation verified in a browser (or honestly marked unverified).

### 04 · Add the first Claude SDK vertical slice
- `AgentService` interface with mock and Claude implementations using the installed SDK's documented `query` API (verified from its type definitions).
- Configured model ID, small turn/cost limits, no built-in filesystem/shell tools, server-only runtime workspace outside the repo.
- Temporary dev-only `POST /api/demo/ask` wired to the Assistant screen; bounded prompt length and time.
- Mock answers labeled; live mode fails clearly without credentials (no silent mock fallback).
- **Accept:** browser question gets a visible mock answer; tests cover validation and adapter failure; live smoke test run only if credentials exist.

## Phase B — Data, authentication, and portfolio management

### 05 · Start PostgreSQL and Redis locally
- Docker Compose with pinned images, health checks, named volumes, localhost-only ports.
- Start/stop/inspect scripts; destructive reset requires explicit confirmation.
- Reusable Prisma client and Redis wrapper; URL validation, bounded retries, graceful close.
- Liveness vs readiness endpoints (readiness reports dependencies without credentials).
- **Accept:** both services healthy, API reaches both, readiness fails when a dependency stops.

### 06 · Create the Prisma schema and deterministic seed
- Models: User, auth sessions, Portfolio, Security (exchange-aware identity), PortfolioTransaction, WatchlistEntry, QuoteSnapshot, NewsArticle, NewsArticleSecurity.
- PostgreSQL numeric columns for money/quantity; deliberate indexes, uniques, and referential actions.
- Idempotent seed: two demo users, multiple portfolios, buys and sells, synthetic news, fixture clock.
- Owner-context repository methods.
- **Accept:** migrations apply to a fresh DB, seeding is idempotent, ownership isolation demonstrated.

### 07 · Implement authentication and authorization
- Maintained Next.js-compatible auth library (chosen from current docs, recorded in an ADR).
- Local demo sign-in (dev/test only; production startup rejects it) plus a production OIDC path for Microsoft Entra ID.
- Secure server-managed sessions, HttpOnly cookies, logout, expiry, `GET /api/me`, CSRF/origin protection.
- Authorization on every non-health route; demo AI route restricted or removed; no wildcard credentialed CORS.
- **Accept:** anonymous rejected, cross-user access blocked, logout invalidates, forged cross-origin mutation rejected.

### 08 · Build portfolio and transaction APIs
- Authenticated portfolio CRUD, paginated transactions, transaction creation via thin Route Handlers + services.
- Validation: decimal strings, positive quantity/price, non-negative fees, USD, dates, long-only inventory across the full chronological ledger; deterministic ordering for equal timestamps.
- Idempotency keys; DB-level serialization (locking or serializable transactions) with bounded retry.
- Archive/soft-delete; corrections as compensating entries (policy documented).
- **Accept:** invalid input, overselling, duplicates, cross-user access, and concurrent sales behave correctly.

### 09 · Implement valuation and performance calculations
- Pure decimal functions: quantity, weighted average cost, cost basis, realized/unrealized gain, market value, allocation.
- Buy fees add to basis; sell fees reduce proceeds; partial sale preserves unit cost; defined rounding boundaries.
- Reference case: buy 10 @ $100 fee $2; buy 5 @ $120 fee $1; sell 6 @ $130 fee $3 → basis $1,603 / 15 sh before sale; sold basis $641.20; realized $135.80; remaining $961.80 / 9 sh; at $125 → MV $1,125, unrealized $163.20.
- Missing/stale quotes handled explicitly (never zero). Owner-scoped summary API.
- **Accept:** tests for the reference case, full liquidation, fractional shares, missing quotes, invalid chronology.

### 10 · Connect the portfolio UI and watchlist
- Replace fixtures with authenticated API data: portfolio dialogs, buy/sell form, transaction history, holdings, allocation chart, summary cards.
- Server-calculated metrics; quote timestamps and stale/missing indicators; duplicate-submit prevention.
- Watchlist CRUD with exchange-aware selection and accessible destructive confirmations.
- **Accept:** two users manage data independently; reference trades show expected UI values; one E2E scenario.

## Phase C — Market data and news

### 11 · Build deterministic provider adapters
- `QuoteProvider` / `NewsProvider` interfaces with source IDs, provider/ingestion timestamps, currency, delay flags, canonical URLs, checkpoints.
- Deterministic mocks with a controllable clock: duplicates, corrections, conflicts, missing quotes, rate limits, outages.
- Explicit mock/live selection; failed live providers never manufacture fresh data; stale cache labeled.
- Reusable provider contract tests.
- **Accept:** full mock demo without credentials; provider mode and freshness visible in the UI.

### 12 · Add live providers and resilient ingestion
- Provider chosen from official docs (ADR); server-only credentials, timeouts, pagination, rate-limit handling, permitted storage only.
- Worker ingestion role: normalization, deduplication (provider ID + canonical URL), security association, correction history, persisted checkpoints, DB lease against duplicate replicas, backoff with jitter.
- **Accept:** mock ingestion end to end; idempotent duplicates; checkpoint restart and provider failure tested; live smoke only with credentials.

## Phase D — Redis, durable events, and SSE

### 13 · Implement caching and the transactional outbox
- Redis cache-aside for quotes/news with TTLs, jitter, versioned and owner-scoped keys, single-flight.
- `OutboxEvent` written in the same DB transaction as domain changes; dispatcher role with lease, bounded retry, publish to Redis Streams.
- At-least-once semantics with stable event UUIDs and idempotent consumers; stream cursors separate from event IDs; bounded retention; snapshot recovery.
- **Accept:** rollback, publish retry, and duplicate handling tested; architecture ADR updated.

### 14 · Build replayable authenticated SSE on the API
- `GET /api/events` (Node runtime, text/event-stream, heartbeats, abort cleanup), cookie-authenticated, no tokens in URLs.
- Typed events: news.available, quote.updated, portfolio.updated, agent.status, agent.text.delta, agent.message.completed, agent.run.completed, stream.reset.
- Per-user cursors; `Last-Event-ID` and validated cursor param; reset to snapshot when expired or out of scope.
- Per-instance independent readers with local fan-out (no single shared consumer group); bounded buffers; periodic session revalidation.
- **Accept:** authorization, replay, heartbeat, cleanup, and duplicate publication tested.

### 15 · Add frontend streaming and snapshot recovery
- Shared SSE connection manager with validation, connection state, cleanup on logout/unmount.
- Targeted cache updates/invalidation; dedupe by event UUID; race-free snapshot-plus-stream handshake; stream.reset handling.
- Live / Reconnecting / Offline indicators without implying real-time upstream data.
- **Accept:** updates without refresh; reconnect catches up; user switch cannot reuse private data or cursors; browser recovery tests.

### 16 · Build the complete live news experience
- News page with filters, source, publication and ingestion times, related securities, mock/delayed labels, pagination, non-disruptive new-articles indicator.
- Detail and portfolio-impact panels; safe links and sanitized content; corrections shown as updates; read state.
- Dev-only fixture injection through the real ingestion path (blocked in production).
- **Accept:** injected article appears once for the relevant user only; repeat injection and correction are idempotent; event journey documented.

## Phase E — Portfolio-aware AI and recommendations

### 17 · Create authorized custom tools
- Read-only tools via the SDK's documented custom-tool / in-process MCP support: getPortfolioSummary, listHoldings, listTransactions, getQuotes, searchNews, getNewsArticle.
- Trusted context from the app, Zod-validated args, bounded results, repository owner checks, source/freshness metadata; domain functions do all arithmetic.
- Built-in tools disabled; allowed tools constrained by SDK configuration; mock adapter exercises equivalent flows.
- **Accept:** tests for valid use, foreign portfolio IDs, malformed input, large results, stale quotes, provider failure.

### 18 · Build grounded portfolio chat
- Conversation and ChatMessage persistence; owner-scoped endpoints; pagination; authorized context builder.
- Versioned system instruction (cite tools/articles, separate fact from interpretation, state missing/stale evidence, no promises or trades).
- Untrusted content treated as data; safe Markdown with validated links; bounded single-process run coordinator.
- **Accept:** "Which recent news affects my largest holding?" uses authorized tools and cites evidence; cross-user attempts fail; demo endpoint removed.

### 19 · Stream agent answers without duplicate text
- `includePartialMessages` (as documented for the installed SDK) mapped to application events with stable message/block IDs and sequence numbers.
- POST creates a run and returns its ID; progress via SSE with a race-free pre-run cursor; completed messages persisted.
- Explicit cancel endpoint and UI using the documented SDK interrupt/abort mechanism; disconnect does not cancel.
- **Accept:** partial+final reconciliation exactly once; tool-only steps, errors, cancellation, and duplicate delivery tested with recorded fixtures.

### 20 · Implement resumable conversations and structured analysis
- Link conversations to SDK session IDs; documented resume; serialize turns per conversation; honest fallback to a summary-seeded new session.
- Zod contract for news analysis (references, categories, securities, facts, interpretations, uncertainties, as-of, evidence); SDK structured output where supported; server validation with bounded retry.
- **Accept:** follow-up works in one session; structured output cannot cite nonexistent sources; cross-pod persistence deferred to 28.

### 21 · Build portfolio impact and research recommendations
- Article-level analysis cached by article revision + prompt/schema version + model config; private conclusions never under shared keys.
- Deterministic exposure/weights; recommendation types (monitor_event, review_concentration, read_primary_source, reassess_assumptions) with rationale, evidence, holdings, uncertainties, counterarguments, as-of.
- Persisted with provenance; explicit invalidation policy on corrections or portfolio changes.
- **Accept:** same article differs per user; unsupported sources rejected; stale evidence visible; contradictory/neutral fixtures.

### 22 · Add recommendation cards and configurable alerts
- Recommendation cards with evidence and caveats; dismiss/save; per-user history.
- AlertRule / AlertNotification CRUD; deterministic thresholds; delivery via outbox + SSE (in-app only).
- Dedupe by user/rule/event revision; cooldowns; explicit no-relevant-news state.
- **Accept:** one notification per rule revision, recovered after reconnect, dismissal persists, no leakage to other users; E2E news-to-recommendation demo.

## Phase F — Advanced Claude Agent SDK capabilities

### 23 · Add focused subagents and an MCP integration
- Optional news-research and portfolio-risk subagents (verified SDK API) with minimal tools; main agent owns the cited answer.
- Ownership propagated to every tool path; bounded depth, concurrency, and aggregate usage.
- One optional external MCP integration, local fixture server first; allowlist, auth, timeouts, size limits.
- **Accept:** both specialists contribute evidence; unavailable MCP fails boundedly; single vs delegated latency/usage compared.

### 24 · Add reusable skills and policy hooks
- Application skills (earnings-news review, daily briefing) in a managed runtime directory; explicit settings sources/cwd so no developer config is inherited.
- SDK hooks for sanitized audit and pre-tool policy checks (complementing in-tool authorization).
- **Accept:** briefing structure correct; forbidden operation rejected; audit correlates with the run; tested from a clean directory.

### 25 · Implement approvals and explicit cancellation
- Assistant proposes watchlist/alert changes; durable ApprovalRequest (owner, run, exact args, hash, type, status, expiry).
- Approve/reject endpoints and UI; re-check on use; one-time consumption; idempotent mutations; changed args need new approval.
- SDK permission mechanism where documented; safe failure if not durable. Cancellation covers waiting runs.
- **Accept:** approve, reject, expiry, double-click, changed args, foreign approval ID, and cancellation tested.

### 26 · Manage context and enforce usage budgets
- Configurable model, prompt/tool-result size, turn, wall-clock, and cost limits (SDK options + app enforcement); record reported model.
- Usage from documented SDK results; atomic per-user daily reservation and reconciliation; conservative crash handling.
- Context summaries preserving sources, scope, and freshness distinctions; clear limit/timeout/reset UI states.
- **Accept:** limits end runs predictably; concurrency cannot bypass reservation; no hanging streams.

## Phase G — Durable workers and production boundaries

### 27 · Move execution into a durable worker
- PostgreSQL-backed AgentRun jobs (queued/running/waiting_for_approval/completed/failed/cancelled) claimed with SKIP LOCKED; leases, heartbeats, fencing by attempt.
- Per-conversation durable lease; deliberate recovery; no unsafe automatic replay.
- Visible chunks persisted in sequenced batches; progress via outbox.
- **Accept:** API restart does not stop jobs; duplicate workers cannot share an attempt; crashed jobs reach a documented outcome.

### 28 · Persist SDK sessions across restarts
- Identify the exact SDK artifacts needed to resume (from official docs).
- `SessionArtifactStore` with local and Azure Blob implementations; scoped keys, versioning, integrity, retention.
- Restore under conversation lease into a dedicated workspace; atomic versioned saves; stale attempts cannot overwrite.
- **Accept:** follow-up succeeds after worker restart with empty workspace; missing/corrupt/simultaneous restore tested; live Blob labeled separately.

### 29 · Harden the application and execution boundary
- Review and fix: cross-user access, prompt injection, unsafe HTML/links, SSRF, secret leakage, broad permissions, unbounded resources.
- Document that a working directory is not an OS sandbox; define the shared-worker trust boundary; optional per-run isolation design.
- **Accept:** adversarial fixtures (injected instructions, foreign IDs, malicious links, exfiltration) blocked independent of model obedience; threat ADR updated.

### 30 · Add distributed recovery and operational controls
- Two API + two worker instances behind a local reverse proxy; cross-instance event delivery; no concurrent conversation execution.
- Graceful shutdown with readiness drop, draining, lease release, truthful interrupted outcomes.
- Per-user and global concurrency limits, queue-depth monitoring, stuck-job detection, authorized and audited admin recovery.
- **Accept:** Redis/worker/API/DB failures and retention expiry produce no duplicate financial mutations, no cross-user events, no falsely completed runs.

## Phase H — Tests, evaluation, and operations

### 31 · Build a meaningful automated test suite
- Consolidate Vitest and Playwright suites with isolated DBs, fixed clocks, provider fixtures, and the mock agent.
- Cover all critical invariants (arithmetic, oversell, idempotency, concurrency, ownership, outbox, SSE, reconciliation, approvals, fencing, session versions).
- E2E: valuation, article-to-recommendation, follow-up chat, cancellation, reconnect, two-user isolation, two-API fan-out.
- **Accept:** one command each for unit, integration, and browser tests; suites run and pass or report exact prerequisites.

### 32 · Add AI evaluation and observability
- Versioned eval dataset with traps (missing quotes, stale news, contradictions, irrelevance, injection); deterministic checks separate from optional model-judged rubrics; mock and budgeted live paths.
- Structured redacted logging, OpenTelemetry tracing, correlated IDs, operational metrics without sensitive labels.
- **Accept:** one article traced from ingestion to browser and one question from agent worker to final message.

## Phase I — Azure AKS deployment and capstone

### 33 · Build production containers and release CI
- Multi-stage, non-root Dockerfiles for web, API, and worker roles; Prisma generation, Next.js output tracing, SDK runtime requirements verified.
- Production-like Compose with SPA fallback and `/api` proxy; containerized mock smoke test; image/secret inspection.
- CI workflow for install, checks, tests, and builds; publish/deploy gated by environment approval and OIDC. No push or deploy.
- **Accept:** images build and pass smoke test; no secrets in assets or layers.

### 34 · Generate and validate Azure infrastructure
- Parameterized Bicep: AKS, ACR, PostgreSQL Flexible Server, Azure Managed Redis, Key Vault, Blob Storage, monitoring (APIs/SKUs verified).
- Workload identity, least-privilege roles, private networking design, credential refresh strategy, cost worksheet.
- **Accept:** Bicep compiles and validates statically; what-if only if already authorized; no resources created; exact provisioning/cleanup commands documented.

### 35 · Create Kubernetes deployment and release procedures
- Helm or Kustomize for web, API, ingestion, outbox dispatcher, and agent worker with probes, limits, identities, security contexts, network policy, disruption settings.
- Supported gateway routing one HTTPS origin; SSE-compatible timeouts and buffering; migration Job before rollout; expand/contract policy; independent scaling.
- **Accept:** manifests render and validate; deployment commands and smoke tests prepared; nothing released without authorization (see prompt R3).

### 36 · Finish the capstone and teaching materials
- Full local production-like capstone with containers and mocks: two users, reference trades, news ingestion, SSE, cited question, approval, cancellation, reconnect, worker restart.
- Regression suite, typecheck, lint, production build; README; `docs/course-map.md` (72 lessons → 36 milestones with demo, exercise, outcome, common mistake); `docs/release-readiness.md`.
- Remove obsolete demo endpoints, dead code, and TODO stubs for required features.
- **Accept:** actual results reported; local-complete vs deployed status stated accurately.

---

## Reusable workflows (not milestones)

- **R1 — Resume or switch coding agents:** reconcile state with the repository, then continue the earliest incomplete milestone.
- **R2 — Diagnose a failed milestone:** reproduce, classify the cause, apply the smallest coherent fix, add a regression test, never weaken security or tests.
- **R3 — Provision and release to Azure:** only with explicit subscription, region, cost, and hostname authorization.
