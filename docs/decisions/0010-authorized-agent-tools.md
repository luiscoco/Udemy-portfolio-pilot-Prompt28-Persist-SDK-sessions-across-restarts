# 0010. Authorized read-only agent tools

- Status: Accepted
- Date: 2026-10-02
- Milestone: 17

## Context

Portfolio-aware chat (milestones 18 onward) needs Claude to read the signed-in user's portfolios,
quotes and news. A model must not choose whose data it reads, compute authoritative money values,
or reach the filesystem, shell or network. The installed Claude Agent SDK is 0.3.276; its type
definitions (`sdk.d.ts`) and the official custom-tools and tool-search documentation define
`tool()`, `createSdkMcpServer()` and the `tools`, `allowedTools`, `disallowedTools`, `mcpServers`,
`strictMcpConfig`, `permissionMode`, `canUseTool`, `settingSources`, `skills`, `agents` and
`plugins` options.

## Decision

**One in-process SDK MCP server per authenticated run.** `createPortfolioToolServer(context)`
registers six read-only tools (`getPortfolioSummary`, `listHoldings`, `listTransactions`,
`getQuotes`, `searchNews`, `getNewsArticle`) under the server key `portfolio`. Each run builds a
fresh server from a trusted context, so a user's context is never shared.

**Trusted context, never model identity.** The context holds an owner-bound data port
(`agentToolReads(db, cache, owner)`), the server `DATA_MODE` and a clock. The owner is the opaque
`AuthenticatedOwner` minted by `authenticateOwner` from the session cookie. No tool schema has a
user, owner or account field. Through the SDK, unknown keys are stripped before the handler runs
(verified over the MCP protocol); direct invocations (the mock adapter) are rejected by `.strict()`
re-validation. In both cases the identity cannot change.

**Ownership in repositories.** Every port method is owner-scoped in SQL by reusing the existing
owner-checked services (summary, transactions, news interest). Quotes and securities are limited
to securities the owner has traded or watches. Another user's IDs produce the same `NOT_FOUND`
(or `unavailableSecurityIds`) as nonexistent IDs.

**Deterministic arithmetic.** Money comes only from domain functions:
`calculatePortfolioSummary`, plus the new `combinePortfolioTotals` (exact signed sums; market value
withheld unless every portfolio is completely valued), `valuationCoverage` (counts) and
`classifyQuote` (the single 15-minute freshness rule, now also used by valuation). The tools only
select, page and clip. Every result reports which domain function produced its values.

**Bounded, labeled results.** Inputs are Zod-validated with hard limits (20 portfolios, 50 holdings
or transactions, 25 quotes, 10 articles per page). Text is clipped (titles 300, summaries 1,000 in
search and 4,000 in detail), provenance is capped at 10 entries and related impacts at 10, and the
serialized result is capped at 48,000 bytes, trimming the main list with honest paging.
Each result carries `meta`: sources, calculation, data mode, UTC generation time, freshness
status/policy/timestamps, page, truncation, an untrusted-text flag for news and notes.
Errors are `INVALID_ARGUMENT`, `NOT_FOUND` or retryable `UNAVAILABLE`, with fixed messages.
Raw exception text (which may include connection strings) never reaches the model.

**Constrained SDK configuration.** `portfolioToolQueryOptions(server)` sets `tools: []` (all
built-ins removed), bare-name `disallowedTools` for common built-ins as a second layer,
`mcpServers: { portfolio }` with `strictMcpConfig: true`, exactly six fully qualified names in
`allowedTools` (no wildcard), `permissionMode: 'dontAsk'`, a deny-by-default `canUseTool` that also
requires `mcpServer.source === 'sdk'`, and empty `settingSources`, `skills`, `agents` and `plugins`.
The live service disables tool search (`ENABLE_TOOL_SEARCH=false`) and marks the server `alwaysLoad`,
so six small schemas load up front. Tool annotations are `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

**Mock parity.** `MockPortfolioAgentService` invokes the same handler functions (same validation,
ownership, bounds and metadata) with a keyword plan, and repeats only returned values.

## Consequences

- The live tool-enabled service exists and its SDK options are tested with a fake `query`.
  Wiring it to a chat route, streaming and grounding evaluation are milestones 18–19 and 32. No live
  Claude call was made in milestone 17.
- The `/api/demo/ask` route is unchanged (general Q&A); its UI copy still says portfolio context is
  not connected. Milestone 18 replaces it with grounded chat.
- `listTransactions` pages oldest first (the existing ledger order); recent trades are on later pages.
- `packages/agent` now depends on `zod` 4.6.5, the instance the SDK/MCP server already use at runtime
  (see `docs/versions.md`), plus `contracts` and `domain`. It still does not depend on Prisma.
