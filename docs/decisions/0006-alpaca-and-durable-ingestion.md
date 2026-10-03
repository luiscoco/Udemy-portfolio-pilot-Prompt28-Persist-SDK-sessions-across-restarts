# 0006. Alpaca adapters and durable ingestion

- Status: Accepted
- Date: 2026-10-02
- Milestone: 12

## Context

No live provider was selected. We need documented stock prices, linked article metadata, pagination,
and credential-free acceptance. API access does not establish redistribution or archival rights.

## Decision

Select Alpaca Market Data HTTP APIs, using Trading API key/secret headers. Basic is available free
to paper/live accounts, covers US stocks/ETFs, and provides limited IEX real-time equity coverage.
Its documented historical allowance is 200 calls/minute. Plus offers consolidated exchange coverage;
we do not subscribe or silently request SIP. The application price is the **last IEX trade**, not a
bid/ask midpoint or NBBO. Catalog MICs identify listings; a trade venue is not a listing MIC.
Duplicate catalog tickers are treated as ambiguous and missing.

Use `GET /v2/stocks/trades/latest?feed=iex` in batches of 100 and
`GET /v1beta1/news` with `include_content=false`, ascending update sort, fixed start/end, limit up
to 50 and opaque page tokens. Benzinga news metadata includes source, author, headline, summary,
ID, creation/update dates and symbols. Initial news lookback is 24 hours; end is deliberately 15
minutes behind the clock to support restricted access. Later windows overlap one hour. This is
polling, with explicitly delayed news and limited-venue IEX prices. Missing/null article URLs are
excluded because our cited-news interface requires a real source link; no links are invented.

**Rights gate:** default `ALPACA_STORAGE_DISPLAY_RIGHTS_CONFIRMED=false` prevents live adapter
construction even with keys. Public documentation does not establish the user's actual entitlement.
Alpaca's general terms limit personal/noncommercial use, require advance notice for user applications,
and require express written consent for specified copying/publication/distribution. An operator must
confirm applicable written rights covering persisted quotes, headlines, metadata, excerpts, history
and this application's intended display before enabling the gate. Basic access alone does not meet
that condition. No supplied credentials or rights agreement were available; live remains unverified.

Only normalized metadata and the API's summary are retained under that confirmed permission; raw
responses, content, images and page HTML are discarded. No scraping, paywall bypass or trading API.
Credentials are server configuration only; live exports have a separate Node-only `/server` entry.

PostgreSQL owns schedule epochs, checkpoints, cursors, retry times, leases and generation fencing.
Claim with database time; lock and check the claim before committing a page. Commit normalized news,
quote snapshots and progress atomically. A short global transaction advisory lock serializes URL/ID
merges across sources. A crash before commit replays the page. A stale owner cannot commit or alter
the replacement's retry state. An overlong operation loses its 120-second lease and safely retries.

Normalize URLs by removing fragments and known tracking parameters, sorting query parameters and
using standard URL host/default-port normalization. Do not remove semantically meaningful query
parameters, rewrite HTTP to HTTPS or follow redirects. Preserve source-ID and URL aliases, immutable
fingerprinted observations, and current metadata from the latest provider timestamp. Ingestion time
does not change the fingerprint. Older replay cannot replace a newer correction. Security association
requires an unambiguous USD stock catalog match; historical symbols stay in observations.

HTTP has a 10-second default timeout (maximum 30 seconds), redirect rejection and payload validation.
Retry scheduling uses capped exponential backoff with jitter and the later of Retry-After and rate
reset guidance; provider guidance is never truncated to the jitter cap. Error bodies/credentials are
never logged. Failures do not advance checkpoints. Successful commits reset failure counts.

## Alternatives considered

- Alpha Vantage documents news/sentiment and stock APIs, but its standard 25 requests/day allowance
  is a poor default for scheduled polling. Educational exemptions require verification, not assumption.
- Finnhub documents company news and prices, but commercial redistribution is separately offered
  through sales. It does not remove the licensing prerequisite. Alpaca's paginated news response,
  update timestamps and combined documented HTTP API fit our ingestion exercise.
- Full SIP coverage, paid news feeds and broker partnerships remain possible future licensed choices.

## Consequences

Mock acceptance proves recovery mechanics, not market-data entitlement or live availability. Broad
international coverage, security discovery, venue mapping automation and full article text are outside
this milestone. The one-hour overlap cannot guarantee discovery of arbitrarily old provider corrections;
those require an intentional backfill window. Authenticated market snapshots still use milestone 11's
process-local service; the durable ingestion feed is prepared for milestone 13's cache/outbox and later
news UI. Existing portfolio summaries can read persisted quote snapshots now.

## References

Official sources checked 2026-10-02; current HTTP docs and OpenAPI, no vendor SDK installed:

- [Alpaca plans/authentication](https://docs.alpaca.markets/us/docs/about-market-data-api)
- [Latest trades](https://docs.alpaca.markets/us/reference/stocklatesttrades-1)
- [News endpoint](https://docs.alpaca.markets/us/reference/news-3)
- [Historical news overview](https://docs.alpaca.markets/us/docs/historical-news-data)
- [Current official OpenAPI, schemas and rate-reset headers](https://github.com/alpacahq/cli/blob/main/api/specs/market-data-api.json)
- [Alpaca terms, pages 1–2](https://s3.amazonaws.com/files.alpaca.markets/disclosures/library/TermsAndConditions.pdf)
- [Alpha Vantage allowance](https://www.alphavantage.co/support/)
- [Finnhub commercial redistribution](https://api.finnhub.io/pricing-startups-and-enterprise)

Prisma 7.10.0 installed generated types and existing `$transaction`/parameterized raw SQL patterns
were checked before implementation. No dependency version changes were required.
