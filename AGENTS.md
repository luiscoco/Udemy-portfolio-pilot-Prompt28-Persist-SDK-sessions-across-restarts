# PortfolioPilot — Project Contract

This file is the single source of project rules for every coding assistant (Claude, GPT, or other).
Tool-specific files such as `CLAUDE.md` only point here; do not duplicate these rules elsewhere.

Before any work, read this file and [docs/project-state.md](docs/project-state.md). The milestone
sequence lives in [docs/project-plan.md](docs/project-plan.md); architecture decisions live in
[docs/decisions/](docs/decisions/README.md).

## Role

You are the implementation partner for PortfolioPilot, a professional Udemy teaching project.
Read existing repository instructions before editing and preserve user changes. When an
implementation prompt is given, deliver real working code — not plans, pseudocode, or stubs.

## Product

A stock portfolio manager with a live news feed, portfolio-aware AI chat, cited news analysis,
research recommendations, watchlists, and alerts.

Fixed scope:

- Users create portfolios, record purchases and sales, inspect valuations, and maintain watchlists.
- Core portfolios hold USD-denominated stocks using weighted average cost. Out of core scope:
  leverage, short selling, options, dividends, corporate actions, taxes, FX conversion, and broker
  execution.
- News appears according to provider availability. Label timestamps and delays explicitly. Polling a
  provider is near-real-time, even when the browser receives it through SSE.
- AI explains holdings and news, produces source-backed research recommendations, and may *propose*
  watchlist or alert changes that require user approval. It never executes trades.
- A deterministic demo runs without AI or market-data credentials.
- The application runtime is always the Claude Agent SDK, regardless of which coding assistant builds it.

## Required architecture

| Path | Responsibility |
| --- | --- |
| `apps/web` | React 19.3 (or a compatible later stable 19.x), Vite, TypeScript. **The only frontend.** |
| `apps/api` | Next.js App Router Route Handlers on the Node.js runtime. No Next.js UI, no Server Actions, no browser imports of backend code. |
| `apps/worker` | Node.js/TypeScript background process with independently selectable roles: ingestion, outbox delivery, agent runs. |
| `packages/contracts` | Zod schemas, browser-safe DTOs, and application event types. |
| `packages/domain` | Pure portfolio calculations and business rules. |
| `packages/db` | Prisma schema, migrations, client, and repositories. |
| `packages/providers` | Quote/news adapters and deterministic mocks. |
| `packages/agent` | Claude Agent SDK adapter and custom tools. Server-only. |
| `packages/config` | Validated server and browser configuration. |
| `packages/observability` | Logging, tracing, and metrics instrumentation. |

- **PostgreSQL is authoritative.** Redis handles caches, replayable event streams, and transient
  coordination. Durable jobs and run state remain in PostgreSQL.
- **Single public origin:** `/api` routes to Next.js; all other paths serve the React static build.
  Locally, the Vite dev server proxies `/api` (web `5173`, API `3001`).
- **Azure target:** AKS, Azure Container Registry, managed PostgreSQL (Flexible Server), Azure
  Managed Redis, Key Vault, and Blob Storage for protected SDK session artifacts when needed.
- Browser-safe packages (`contracts`, browser config) must never depend on Prisma, Node-only
  modules, the agent SDK, or server secrets.

## Implementation rules

1. **Verify before use.** Check current official documentation and installed type definitions
   before using version-sensitive APIs, especially the Claude Agent SDK, Prisma, Next.js,
   authentication, and Azure resources. Never invent SDK methods, model IDs, package versions, or
   Azure SKUs.
2. **Tooling.** Prefer npm workspaces, strict TypeScript, Zod, Vitest, Playwright, and accessible UI
   components. Pin resolved versions and commit the lockfile when a commit is authorized. Do not
   upgrade dependencies between milestones without a concrete compatibility reason, recorded in
   `docs/versions.md`.
3. **Financial correctness.** USD stocks, long-only positions, weighted average cost, explicit fees,
   UTC timestamps, decimal money/quantity arithmetic (never binary floating point), no broker trades.
   Return decimals as strings over JSON.
4. **Secrets.** No secrets in browser bundles, prompts, logs, fixtures, or git. Read credentials only
   from server configuration. Mock mode must work without credentials and be visibly labeled in the UI.
5. **Ownership.** Enforce ownership in repositories, APIs, streams, and agent tools. Derive the user
   from the authenticated session — never from model-supplied or browser-supplied user IDs.
6. **Least-privilege agent.** Start with zero privileged built-in agent tools (no filesystem, shell,
   or web tools). Add only explicitly needed application tools. News and external tool output are
   untrusted input. Use cited evidence; never invent price targets or certainty.
7. **Stable events.** Expose our own typed application events, not raw SDK messages. Stream only
   user-visible answer text and sanitized tool progress — never hidden reasoning or secrets.
8. **Cancellation.** A browser disconnect is not agent cancellation. Provide an explicit
   cancellation operation. Durable completion must survive browser reconnection.
9. **Milestone workflow.** For every implementation prompt: inspect current state, make a short
   plan, implement the requested slice, run relevant checks, and update `docs/project-state.md` and
   the lesson notes (`docs/lessons/`). Stop after that slice. No fake passing tests and no TODO-only
   implementations of required behavior.
10. **Honest verification.** Document blocked verification honestly, including the missing
    dependency and the exact next command. Continue independently on unblocked local work. Ask only
    when a material decision or authorization is genuinely missing.
11. **Authorization boundaries.** Do not overwrite existing instructions, reset git, delete unrelated
    files, provision paid cloud resources, deploy publicly, or push code without explicit
    authorization. Prepare and validate release artifacts locally first.

## Documentation conventions

- `docs/project-plan.md` — the 36 milestones with scope and acceptance criteria. Change only with a
  recorded reason.
- `docs/project-state.md` — current truth: last completed milestone, actual check results, blockers,
  and next step. Update at the end of every milestone.
- `docs/decisions/NNNN-title.md` — architecture decision records (see the README there).
- `docs/lessons/NN-topic.md` — teaching notes per milestone.
- `docs/versions.md` — pinned versions and compatibility rationale (created in milestone 01).
- Never overwrite an existing instruction file; merge relevant additions while keeping its rules.

## Completion report format

Every milestone ends with a report containing:

1. **What works** — the behavior now available.
2. **Changed files** — created/modified/removed.
3. **Check results** — the commands actually run and their real output summary (pass/fail/skipped).
4. **How to demonstrate it** — exact commands and UI steps.
5. **Remaining limitations** — unverified behavior, blocked checks (with missing dependency and next
   command), and known gaps.
