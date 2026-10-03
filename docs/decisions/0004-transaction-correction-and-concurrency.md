# 0004. Transaction correction and concurrency

- Status: Accepted
- Date: 2026-10-01
- Milestone: 08

## Decision

Posted BUY/SELL trades are immutable. No update/delete trade endpoint exists. Correct inventory by posting explicitly dated compensating BUY/SELL entries, with their actual price and fees, then posting the replacement if necessary. Every intermediate chronological ledger must remain long-only. Compensation is another financial entry, not an invisible erasure or a reversal of all historical cost/profit effects; unsupported corrections require a future audited correction workflow. Do not silently change existing trades.

Portfolio PATCH changes only the name. Currency and ownership cannot change. DELETE archives, is repeatable, and keeps history available to its owner; archived portfolios reject renames/new trades and cannot be restored in this milestone. Exact idempotency replays remain readable after archive. Lists include archivedAt so clients can distinguish archives.

Each trade/rename/archive acquires an owner-filtered PostgreSQL portfolio row FOR UPDATE in an interactive ReadCommitted transaction. All supported mutation paths use this lock, not Redis. After waiting, subsequent reads see the preceding commit. Lock timeout is 1.5 seconds, transaction timeout 10 seconds, pool wait 2 seconds; retry recognized lock/deadlock/serialization conflicts at most three attempts, with bounded delay. Exhaustion returns 503. The full ledger including the proposed insert is checked before commit; failure rolls back the trade and idempotency record together.

Ordering is occurredAt ascending, then a globally unique PostgreSQL bigint sequence ascending. Equal-time trades follow successful posting order within the portfolio; rejected transactions may consume sequence numbers. Migration preserves previous occurredAt/id ordering of existing rows. A late equal-time purchase cannot precede an already posted sale. Sequence values stay internal and never cross JSON as bigint.

Required Idempotency-Key header: 1–128 ASCII letters/digits/period/underscore/colon/hyphen. Unique per portfolio forever, retained with archive. A SHA-256 fingerprint of the validated canonical request normalizes decimals; exact repeat returns the original trade with replayed=true. Reuse with a different payload returns 409. Concurrent same-key requests converge under the same database lock. Different keys intentionally describe separate trades.

Inputs fit numeric(28,10): up to 18 integer and 10 fractional digits; positive quantity/price, nonnegative fees, plain fixed-point strings, no exponents/signs/leading zeros. Dates require UTC ISO with three fractional digits, valid calendar dates, and no future trades. Identity resolves an existing USD STOCK by symbol plus exchange MIC; clients cannot create securities through this endpoint. SELL fees cannot exceed gross proceeds. Quantity and amount arithmetic uses bigint fixed-point units. Amounts round half up to ten decimal places, matching the PostgreSQL CHECK constraint; values outside numeric(38,10) fail before writing.

Pagination uses bounded limit/offset in the same deterministic order, returning nextOffset. Refresh from offset zero after ledger changes: inserting backdated trades can shift offsets between requests. Snapshot pagination and broad audit tooling are deferred.

## Alternatives

Redis-only coordination would not make financial changes atomic. Serializable isolation also works but adds retries; a single portfolio row lock directly serializes this aggregate. Physical deletion would erase trade history. Mutable posted trades would complicate idempotency and audits.

## References

Checked 2026-10-01: installed Prisma 7.10.0 generated interactive $transaction types (isolationLevel/maxWait/timeout), installed Next.js 16.3.8 route.md (promise params and Web Response), [PostgreSQL row locking](https://www.postgresql.org/docs/17/explicit-locking.html), [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route). Current [Prisma transaction docs](https://www.prisma.io/docs/orm/fundamentals/transactions) describe ORM 8 APIs; this milestone deliberately uses the installed pinned ORM 7 interface, with no dependency upgrade.
