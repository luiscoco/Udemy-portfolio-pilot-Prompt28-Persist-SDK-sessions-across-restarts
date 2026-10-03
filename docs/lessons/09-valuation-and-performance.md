# 09 — Exact valuation and weighted average accounting

The pure `calculatePortfolioSummary` function replays immutable trades by UTC timestamp and database ledger order. Inventory is separate for each security ID (including exchange identity). Any prefix oversell, future trade, duplicate order, invalid decimal, nonpositive quantity/price or sell fee above gross proceeds is rejected. Input arrays are never mutated.

## Accounting and precision

Buy basis is quantity × price + fees. A sale removes basis × sold quantity / previous quantity and realizes quantity × price − fees − sold basis. This leaves the remaining unit cost unchanged. Full liquidation leaves exactly zero inventory/basis and null average cost; subsequent purchases start a new average while lifetime realized gains remain.

Decimal inputs match storage's nonnegative 18 integer / 10 fractional digits. BigInt numerators and denominators, reduced by greatest common divisor, preserve exact decimal products and repeating weighted averages without any intermediate rounding. Ledger `amount` is deliberately not used: it is a rounded posting amount, while original quantity, price and fees retain precision. This adds no dependencies and does not change stored transactions.

The output boundary rounds USD amounts to two places, quantity and unit cost to ten places, and allocation ratios (0–1) to ten places, using half up, with negative ties away from zero. Aggregates are rounded from exact totals, never summed from rounded position strings. Consequently displayed rows can differ by a cent from a displayed total and rounded weights need not sum exactly to one. Output strings must never be fed back into ledger accounting. There are no gain percentages labeled as investment returns: cash flows and valuation history needed for time-weighted returns are outside this slice.

The reference buys create $1,603 basis for 15 shares and unit cost 106.8666666667 at the output boundary. Selling six removes $641.20 basis, nets $777 proceeds and realizes $135.80. Nine shares retain $961.80 basis; a $125 quote gives $1,125 market value and $163.20 unrealized gain.

## Quote policy and summary API

`GET /api/portfolios/:id/summary` derives ownership from the authenticated session and responds with `{ summary }`, shared browser-safe Zod DTOs, decimal strings and `Cache-Control: no-store`. A foreign or absent portfolio returns the same 404; anonymous requests return 401. Archived portfolios remain readable. A bounded repeatable-read transaction reads the full owner-filtered ledger and latest quote per security, avoiding pagination truncation and inconsistent snapshots.

Quote freshness is an explicit conservative 15-minute age policy, inclusive at the boundary, relative to server `asOf`. Future quotes are excluded. Each position exposes `fresh`, `stale`, `missing`, `invalid` (non-USD/nonpositive/malformed price), or `not_required` for closed positions. Quote timestamps, provider and synthetic labels accompany available quotes. Stale quotes remain visible as metadata but do not value positions. Missing/stale/invalid open positions have null market value and unrealized gain. Portfolio totals and all allocation weights are null until every open holding has a usable quote; known accounting totals and individually priced holdings remain available. Empty and fully liquidated portfolios have zero valuation and null allocation weights, requiring no quote. This freshness rule is not an exchange calendar or a claim that synthetic prices are live.

## Demonstrate and check

```powershell
npm ci
npm run typecheck
npm run test --workspace @portfolio-pilot/domain
npm run build
npm run check:browser-boundary
```

With the local database configured/migrated, run `npm run dev`, open http://localhost:5173 and sign in as Alice. Use lesson 08's console helper to create a portfolio and post the reference buys/sale with distinct idempotency keys and UTC dates. Then run:

```js
await send(`portfolios/${id}/summary`, 'GET');
```

Seed quotes are historical and deliberately report stale valuation. The PostgreSQL acceptance test creates and removes its own fresh synthetic $125 quote to check the entire reference and owner isolation. Sign in as Bob and request Alice's ID to observe 404. Screens still display fixtures until milestone 10.

Reuse the dedicated disposable database from lesson 08 (never application data):

```powershell
$env:PORTFOLIO_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
npm run test --workspace @portfolio-pilot/api
```

Official APIs verified against installed Next.js 16.3.8 route documentation/types and Prisma 7.10.0 isolation types on 2026-10-02: [Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [Prisma v7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions). No dependency version changed. Exact fractions favor correctness; full history replay and rational numerator/denominator growth can be expensive for very long histories. Provider ingestion, calendar-aware freshness, UI integration and cash-flow-adjusted returns remain later scope.

## Actual verification

Pinned offline installation, full workspace typecheck, production build and browser dependency boundary passed. Initial Prisma generation needed access to the installed engine cache; that retry passed. Final full workspace tests with both disposable database URLs passed 55 tests, none skipped: eight domain tests (seven new valuation tests) and all 26 API tests including nine PostgreSQL portfolio acceptance tests. Domain test discovery now targets `src`, avoiding duplicate executions from built `dist` tests. Existing Vite directive and Next instrumentation warnings remain. No live browser smoke was run; use the console demonstration above for that optional check. No dependencies upgraded, data reset, paid resources or deployment.
