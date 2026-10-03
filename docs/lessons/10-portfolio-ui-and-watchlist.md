# 10 — Authenticated portfolios and watchlists

Dashboard and Portfolios now read PostgreSQL-backed, authenticated portfolio APIs. The shared selector includes archives. Create and rename dialogs change portfolio metadata; archiving is an explicit confirmation and leaves history readable. Buy/sell entries are immutable records of executed trades, never broker orders. History is paginated in chronological ledger order, ten entries per page. Holdings include sold-out positions and lifetime realized gains. Empty portfolios show explicit guidance.

## Precision and valuation

Keep quantity, price and fees as raw strings through form state, Zod validation and JSON. Do not use `Number`, `parseFloat`, HTML numeric coercion, or rounded display amounts for accounting. The server replays the complete ledger; history pagination does not truncate summary calculations. Cards, holdings and allocation bars consume server-calculated metrics. There is no invented cash balance, daily return or performance chart.

`decimal-display.ts` uses BigInt for deliberate half-up display rounding, including large amounts and negative ties. Money displays USD and two places; quantities retain all nonzero fractional digits. Unit cost displays cents with the original ten-place value in its tooltip. Percent labels and bar widths shift the server allocation ratio using string arithmetic. Null valuations display “Unavailable”, never zero. Server precision and rounding policy remain those of lesson 09.

Every quote shows its timestamp in UTC, provider, currency context, freshness status and synthetic marker. Stale/missing/invalid quotes prevent valuation and allocation as specified by the server. Sold-out positions require no quote. Summary refreshes every minute while mounted; this is a snapshot refresh, not a live provider feed. Historical seed quotes normally appear stale.

## Ownership, submissions and accessibility

`/api/securities` supplies the supported USD stock catalog with ID, symbol, exchange MIC, name and currency. ACME on XNAS and ACME on XNYS are separate choices. Watchlist GET/POST and item PATCH/DELETE derive owners from verified sessions; owner IDs in mutation payloads are rejected. Adding the same security is an upsert; separate users may follow the same security independently. Edit/remove filter by both item ID and owner. Unknown/foreign items return 404, unknown/non-USD securities are rejected, uniqueness conflicts return 409, and responses are no-store.

Every new mutation uses a synchronous ref lock plus disabled controls while pending. A failed trade retains its idempotency key for the same payload while the dialog remains open. Edited inputs receive a new key. These controls complement backend locking and idempotency. After an uncertain timeout, retry the unchanged form before closing it. Closing and reopening does not retain that request key; check the ledger before re-entering an uncertain trade.

Native modal dialogs provide a named modal, keyboard containment, Escape cancellation and focus restoration. Archive/removal confirmation names the affected resource. Pending operations cannot be dismissed. Read errors expose retry actions, mutation errors preserve inputs, and loading/empty states are explicit. A 401 immediately clears the query cache and returns to sign-in; the existing session timer/focus refresh remains active. Signing out also clears account data.

## Demonstrate

With an already migrated/seeded local PostgreSQL database, use the existing API environment configuration (`apps/api/.env.example`) and start:

```powershell
npm run dev
```

Open http://localhost:5173, sign in as Alice Demo, open Portfolios and create a portfolio. Record these ACME / XNAS / USD trades with UTC dates:

| Date | Side | Quantity | Price | Fees |
| --- | --- | --- | --- | --- |
| 2025-01-01 00:00:00 | Buy | 10 | 100 | 2 |
| 2025-01-02 00:00:00 | Buy | 5 | 120 | 1 |
| 2025-01-03 00:00:00 | Sell | 6 | 130 | 3 |

Expect nine shares, USD 961.80 remaining basis and USD 135.80 realized gain. A fresh synthetic USD 125 quote gives USD 1,125.00 market value, USD 163.20 unrealized gain and 100% allocation. With historical seed quotes those three valuation fields are unavailable and clearly labeled stale. Refresh, reselect the portfolio and inspect persisted history. Rename, then archive it: the history remains and mutation buttons become disabled. Add/edit/remove a watchlist security; cancel removal to verify focus restoration. Sign out, sign in as Bob and observe separate portfolios/watchlists.

## Automated verification

Use the dedicated loopback acceptance databases from lessons 07–09; never point these acceptance tests at application data. The browser scenario inserts its own temporary fresh quote, security and portfolios and removes only those resources. It also creates Bob's portfolio/watchlist item, checks reference metrics and refresh persistence, then exercises canceled/confirmed removal, sold-out positions, the second history page, rename/archive persistence and a simulated 401 returning to sign-in. Existing shell scenarios now authenticate and use persisted seed IDs.

```powershell
npm run typecheck
npm run build
npm run check:browser-boundary
$env:PORTFOLIO_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
$env:AUTH_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m07_auth_verify'
npm run test
```

For browser acceptance, start the API/web against the same dedicated database in one terminal:

```powershell
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
$env:AGENT_MODE='mock'
npm run dev
```

Then in another terminal:

```powershell
$env:PORTFOLIO_E2E_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
npm run test:browser --workspace @portfolio-pilot/web
```

Chrome must be installed for the pinned Playwright configuration. Browser acceptance is opt-in if the dedicated URL is absent; the three shell scenarios still require the running seeded local API and demo authentication. Node 24.21.0 and npm 11.19.0 were invoked with the installed nvm directory prepended to PATH. No dependency version or lockfile changes.

Version-sensitive Route Handler APIs were checked against installed Next.js 16.3.8 docs and [official Route Handler reference](https://nextjs.org/docs/app/api-reference/file-conventions/route); query options against installed TanStack Query 5.102.8 definitions. Prisma owner filters/upsert/updateMany were verified against generated Prisma 7.10.0 types. See project-state for final actual check outcomes.

## Limits

The supported security selector uses the current database catalog. Provider search, live quotes and ingestion are later milestones. News and the general assistant retain their explicit demo behavior. Real Entra sign-in still needs credentials for live verification. Transaction pagination uses stable chronological offset ordering but is not a frozen history snapshot across concurrent/backdated inserts. Browser controls cannot guarantee create requests are never duplicated after an ambiguous network failure; portfolio uniqueness, watchlist uniqueness and financial idempotency remain server responsibilities.
