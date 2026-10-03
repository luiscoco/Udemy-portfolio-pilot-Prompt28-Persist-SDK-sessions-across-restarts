# 0005. Exact valuation and quote policy

- Status: Accepted
- Date: 2026-10-02
- Milestone: 09

## Context

Weighted-average basis division can repeat indefinitely. Rounding unit cost during a partial sale changes the remaining cost and introduces residual basis on liquidation. Market data may be absent or historical, including deterministic seed quotes.

## Decision

Use reduced BigInt rational numbers parsed from fixed decimal strings for pure domain valuation. Replay original quantity, price and fees, preserving exact products and divisions internally. Round only DTO output: USD to two places; quantity, unit cost and allocation ratios to ten; half up, negative ties away from zero. Aggregate before rounding. No new decimal dependency or database change is needed.

Read summaries using an authenticated owner context and one bounded PostgreSQL repeatable-read transaction over the entire ledger and latest nonfuture quote per security. A conservative explicit 15-minute age boundary determines fresh quotes. Expose quote metadata/status; suppress valuations for stale/missing/invalid prices and suppress portfolio totals/weights if any open position is unpriced. Closed positions need no quote. Do not describe gains as time-weighted investment returns.

## Alternatives considered

Fixed decimal precision during each division accumulates drift. A new arbitrary-precision library would still need a division precision policy and an added dependency. Treating missing quotes as zero silently invents losses; excluding unpriced positions from allocation would misleadingly normalize only part of the portfolio.

## Consequences

Partial sales preserve exact unit cost; liquidation leaves no residual basis. Displayed rounded row amounts may differ from exact-rounded totals. Rational numerator and denominator growth and full history reads limit scalability; future optimization must preserve these invariants. The age policy is not exchange-calendar aware and seeded historical quotes intentionally report stale. UI connection and provider ingestion remain future milestones.

## References

Verified 2026-10-02 against installed Prisma 7.10.0 generated isolation definitions and Next.js 16.3.8 bundled route documentation: [Prisma v7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions), [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route).
