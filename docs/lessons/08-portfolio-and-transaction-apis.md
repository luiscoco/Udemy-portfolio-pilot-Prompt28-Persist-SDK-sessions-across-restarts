# 08 — Portfolio and transaction APIs

Thin Node.js Route Handlers authenticate first and call an owner-scoped application service. Shared Zod schemas reject unknown fields and invalid inputs. The service coordinates persistence and calls the pure domain inventory validator; PostgreSQL remains authoritative. See [ADR 0004](../decisions/0004-transaction-correction-and-concurrency.md) for precision, ordering, archive, correction and concurrency policies.

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | /api/portfolios | List all owned portfolios / create with name and optional USD currency |
| GET / PATCH / DELETE | /api/portfolios/:id | Read / rename only / archive |
| GET | /api/portfolios/:id/transactions?limit=50&offset=0 | Chronological page and nextOffset |
| POST | /api/portfolios/:id/transactions | Post immutable trade with required Idempotency-Key header |

Create portfolio returns 201 and `{portfolio}`. Other successes return 200; trades return `{transaction,replayed}`. All JSON financial values are strings. Invalid input is 400, absent/foreign portfolio 404, inventory/archive/key conflict 409, contention exhaustion 503. Authentication/origin protection is the milestone 07 session boundary; every mutation requires the exact configured Origin. Responses use no-store. Unknown trade security is 400 without auto-registering arbitrary instruments.

## Demonstrate

Follow lesson 07 local setup, then apply the new migration before starting:

```powershell
npm run build:types
npm run migrate:deploy --workspace @portfolio-pilot/db
npm run dev
```

Open exactly http://localhost:5173 and sign in as Alice. Financial UI still uses fixtures until milestone 10. In browser developer tools console use the real session:

```js
const send = async (path, method, body, key) => {
  const r = await fetch('/api/' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: r.status, body: await r.json() };
};
const created = await send('portfolios', 'POST', { name: 'Lesson 08', currency: 'USD' });
const id = created.body.portfolio.id;
const trade = {
  security: { symbol: 'ACME', exchangeMic: 'XNAS', currency: 'USD' },
  side: 'BUY', quantity: '10', price: '100', fees: '2',
  occurredAt: '2025-01-02T00:00:00.000Z'
};
await send(`portfolios/${id}/transactions`, 'POST', trade, 'lesson-buy-1');
await send(`portfolios/${id}/transactions`, 'POST', trade, 'lesson-buy-1'); // same ID, replayed=true
await send(`portfolios/${id}/transactions`, 'POST', { ...trade, side: 'SELL', quantity: '11' }, 'lesson-sale-1'); // 409
await send(`portfolios/${id}/transactions?limit=1&offset=0`, 'GET');
await send(`portfolios/${id}`, 'PATCH', { name: 'Renamed lesson 08' });
await send(`portfolios/${id}`, 'DELETE'); // history preserved
await send(`portfolios/${id}/transactions`, 'GET');
```

Sign out, sign in as Bob, request Alice's ID and observe 404. ACME/XNAS and ACME/XNYS are separate synthetic identities, not real investment evidence.

## Focused PostgreSQL acceptance

Create the dedicated database once in the existing verification container. Tests refuse any other database name or non-loopback host, create unique portfolios, and remove only those portfolios afterward. Fixtures and test sessions stay in this disposable database. No Redis is required.

```powershell
docker exec portfolio-pilot-m06-verify psql -U portfolio_local -d postgres -c 'CREATE DATABASE portfolio_m08_verify'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
npm run migrate:deploy --workspace @portfolio-pilot/db
$env:PORTFOLIO_TEST_DATABASE_URL=$env:DATABASE_URL
npm run test --workspace @portfolio-pilot/api
```

Unset the variable to run only local tests; the integration tests explicitly skip. Coverage includes sessions/origin, CRUD/archive, every cross-owner resource method, invalid inputs with zero writes, simultaneous same-key requests and conflicting payloads, archived replays, backdated changes breaking future inventory, equal-time order, offset pages, conflicting concurrent sales, archive races, exact tiny quantities/half-up rounding, lock retry exhaustion and retry after contention.

Do not compute inventory with JavaScript Number, validate only today's balance, sort identical timestamps by randomly generated IDs, use Redis locks as the financial boundary, or delete a ledger to make a correction. The row lock is effective because every supported mutation uses it; direct privileged database writes and the explicit development fixture seed are outside the application mutation boundary. Seeding is not a financial correction tool.

Offset pagination is not a cross-request snapshot. Restart pagination after new/backdated trades. Full ledger validation is linear in portfolio history and intentionally favors correctness in this teaching slice. More advanced audited corrections, archive restoration, valuation and UI integration are later work.

## Actual verification

Fresh migrations and an additive upgrade of the existing disposable authentication DB passed. Full workspace tests with both database URLs enabled passed 48 tests, including all 25 API tests (eight new portfolio integration checks, eight existing authentication checks). Full typecheck/build, final API rebuild, Prisma schema validation and browser dependency boundary passed. Initial test failures were corrected: use the seeded ACME identity; inspect the pinned Prisma adapter's nested originalCode to classify lock timeouts for retries. Existing Vite and Next instrumentation warnings remain. No live browser/network smoke of these new routes was run; the console steps above are the next manual check. The historical standalone milestone 06 verifier was updated for the new archive/error/sequence behavior but not rerun.
