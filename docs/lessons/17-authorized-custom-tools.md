# 17 — Authorized custom tools

## What the learner builds

Six read-only Claude Agent SDK tools give a future chat (milestone 18) facts about the signed-in
user's portfolios, quotes and news, without trusting the model with identity, arithmetic or system
access. The design is recorded in [ADR 0010](../decisions/0010-authorized-agent-tools.md).

```
session cookie ─▶ authenticateOwner ─▶ agentToolReads(db, cache, owner)   (packages/db, owner-scoped SQL)
                                          │
                     portfolioToolContext(…, DATA_MODE) (apps/api/lib/agent-tools.ts)
                                          │
        createPortfolioToolServer(context) ─▶ in-process MCP server "portfolio" (packages/agent)
                                          │
        portfolioToolQueryOptions(server) ─▶ query({ tools: [], allowedTools: [6 names], … })
```

## The tools and when the model should use them

The descriptions below are summaries; the exact model-facing text is `TOOL_DESCRIPTIONS` in
`packages/agent/src/tools/portfolio-tools.ts`, and the server sends `PORTFOLIO_TOOL_SERVER_INSTRUCTIONS`.

| Tool | Use it when | Key arguments (all optional unless noted) | Returns |
| --- | --- | --- | --- |
| `getPortfolioSummary` | First call for any portfolio question; discovers portfolio IDs | `portfolioId` | Without an ID: every owned portfolio with totals, coverage, archived flag and exact combined active totals. With an ID: that portfolio's totals and coverage |
| `listHoldings` | "What do I own?", position size, per-holding performance | `portfolioId` (required), `includeClosed`, `limit` ≤ 50, `offset` | Positions with quantity, average cost, basis, gains, market value, allocation fraction, quote price/provider/asOf/age/status |
| `listTransactions` | Trade history, fees, when something was bought or sold | `portfolioId` (required), `limit` ≤ 50, `offset` | Ledger rows oldest first with the stored amount |
| `getQuotes` | Current price questions | `securityIds` (1–25) | Latest stored quote per held/traded/watched security with `fresh`/`stale`/`missing`/`invalid`, age and provider; foreign IDs listed as unavailable |
| `searchNews` | News about holdings/watchlist, by text, ticker, portfolio or watchlist | `query`, `symbols`, `portfolioId`, `scope`, `limit` ≤ 10, `cursor` | Article IDs, clipped headline/summary, publisher, publication/ingestion timestamps, delay/synthetic labels |
| `getNewsArticle` | Before explaining how one story relates to the portfolio | `articleId` (required) | Longer summary, provenance (≤ 10), related holdings with server-calculated values, watchlisted IDs |

Every result has `meta`: `sources`, `calculation` (the domain function that produced money values,
or `null` for stored records), `dataMode`, `generatedAt`, `freshness` (status, 15-minute quote policy,
oldest/newest timestamps), `page`, `truncated`, `untrustedText` (news) and `notes`. In mock mode a
note says prices and news are synthetic. Errors use `{ error: { code, message, retryable } }` with
`isError: true`. `NOT_FOUND` is identical for foreign and nonexistent IDs. `UNAVAILABLE` tells the
model not to estimate and never contains raw exception text.

## Authorization and least privilege

- **Identity:** no schema field accepts a user. The owner is bound in the repository closure from
  the verified session. A `userId` sent through the SDK is stripped before the handler runs (the
  protocol test proves the trusted owner's data is still returned). A direct invocation with an
  unknown key is rejected by strict re-validation.
- **Ownership:** repositories filter by owner in SQL. `getQuotes` only serves securities the owner
  has traded or watches, which avoids enumerating arbitrary instruments.
- **Arithmetic:** the tools never add or multiply money. Totals come from
  `calculatePortfolioSummary` and `combinePortfolioTotals`, counts from `valuationCoverage`, and
  freshness from `classifyQuote`. Valuation now calls the same `classifyQuote`, so chat and UI agree.
- **SDK configuration:** `tools: []`; `disallowedTools` for built-ins as a second layer;
  `mcpServers` holds only `portfolio`, with `strictMcpConfig: true`; `allowedTools` lists exactly
  `mcp__portfolio__<name>` for the six tools; `permissionMode: 'dontAsk'`; `canUseTool` denies
  anything else, including a same-named tool from a non-`sdk` source; `settingSources`, `skills`,
  `agents` and `plugins` are empty; tool search is off and the server is `alwaysLoad`.
- **Untrusted news:** article text is returned only as labeled data. The system prompt and
  instructions tell the model never to follow instructions in it.

## Mock adapter

`MockPortfolioAgentService(context)` plans from keywords (summary by default; holdings, trades,
prices, news) and calls the **same handler functions** the SDK server registers. The answer repeats
only tool values, labels itself `[Mock answer]`, reports failures honestly and returns a
sanitized `toolCalls` trace (`tool`, `arguments`, `outcome`, `errorCode`). The existing
`/api/demo/ask` route and Assistant page are intentionally unchanged until milestone 18.

## How to demonstrate it

Environment for this sandbox (PowerShell):

```powershell
$env:PATH='C:/Users/luisc/AppData/Local/Author Software/nvm/installs/v24.21.0;'+$env:PATH
npm.cmd ci --ignore-scripts --offline --cache .npm-cache
$env:PRISMA_SCHEMA_ENGINE_BINARY=(Join-Path $PWD 'node_modules/@prisma/engines/schema-engine-windows.exe')
npm.cmd run build
```

Credential-free unit demonstration (fake owner-bound port, real domain calculations, real SDK server):

```powershell
npm.cmd run test --workspace=@portfolio-pilot/agent -- --reporter=verbose
```

Real PostgreSQL demonstration with Alice and Bob (disposable loopback `*_verify` database):

```powershell
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d portfolio_m06_verify -c "CREATE DATABASE portfolio_m17_verify"
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m17_verify'
npm.cmd run migrate:deploy --workspace=@portfolio-pilot/db
$env:NODE_ENV='development'; $env:ALLOW_DEMO_SEED='true'; npm.cmd run seed:demo --workspace=@portfolio-pilot/db
$env:DATA_MODE='mock'; $env:AGENT_TOOLS_TEST_DATABASE_URL=$env:DATABASE_URL
npm.cmd exec --workspace=@portfolio-pilot/api -- vitest run lib/agent-tools.integration.test.ts --reporter=verbose
```

The suite creates Alice-only fixtures: three securities (fresh, one-hour-stale and unquoted
quotes), 120 trades and 15 articles, one containing an injection-like headline. It shows valid
results with domain values and freshness. Bob gets `NOT_FOUND` for each of Alice's IDs, malformed
and forged-cursor inputs are rejected, and paging is bounded. A Redis outage fails open, and a
failing quote store returns a sanitized `UNAVAILABLE`. The mock agent answers for Alice and Bob
separately. It deletes its fixtures afterwards. To inspect an answer interactively, add a
`console.log(aliceAnswer)` locally in the last test; do not commit it.

## Checks and teaching points

- Verify SDK APIs in installed types before coding; this release validates raw Zod shapes
  non-strictly, which is why identity must be bound outside the schema.
- Keep tool output small and self-describing: page, clip and state freshness. A model cannot
  label data it was never told is stale.
- Return composed errors (`isError`) rather than throwing, so the model reads safe messages.
- Live tool use with Claude is not exercised here; milestone 18 adds the grounded chat route and
  milestone 32 adds evaluation.
