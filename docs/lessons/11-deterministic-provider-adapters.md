# 11 — Deterministic provider adapters

`packages/providers` defines application-owned `QuoteProvider` and `NewsProvider` interfaces. Values carry source and record identifiers, provider and ingestion UTC timestamps, synthetic/delayed flags and explicit delay milliseconds. Quotes have exchange-aware identities, decimal string prices and currency. News carries a canonical HTTP(S) URL, publication time and revision. A quote batch returns explicit missing identities; a news page returns a next cursor and a checkpoint through the last delivered record. Opaque checkpoint formats are adapter-owned and never frontend contracts. Vendor payloads and credentials do not belong in `packages/contracts`.

## Capabilities actually implemented

| Adapter | Delivery | Timeliness | Pagination | Checkpoints | Corrections |
| --- | --- | --- | --- | --- | --- |
| MockQuoteProvider | Polling/batch requests | Synthetic, simulated 1000 ms delay | No | Fetch timestamp, not a resumable quote stream | No |
| MockNewsProvider | Polling | Synthetic, simulated 1000 ms availability delay | Yes, 1–100 scheduled records per page | Cursor/checkpoint resume | Same source record and canonical URL, revision increases |
| Live | No adapter installed | Unknown | Unknown | Unknown | Unknown |

Polling does not imply upstream push or real-time prices. The browser refreshes `/api/market` every five seconds; the mock schedule defaults to a new news record every thirty seconds. Arrival is derived from clock time, never random numbers or timer ordering. Quote samples are fixed decimal prices (ACME/XNAS 125.00, ACME/XNYS 85.00, NOVA/XNAS 72.50), stamped with the simulated one-second delay. Unknown identities are missing, never priced at zero.

`ManualClock` accepts a UTC epoch and advances by nonnegative integer milliseconds. The first article becomes available at epoch + 1000 ms; subsequent articles at epoch + n × interval + 1000 ms. Passing the same clock, epoch, interval and scenario reproduces identical output. Each factory adapter shares the same epoch. Without `MOCK_START_AT`, the API snapshot service starts its schedule when first initialized. Explicit epochs support repeatable replay. Pages are bounded, and checkpoint advancement never jumps over undelivered pages. Scope changes or foreign/future/malformed checkpoints fail explicitly.

`MOCK_SCENARIO` selects ordinary, duplicates, corrections, conflicts, missing_quotes, rate_limit or outage. Duplicate delivery repeats the first record. A correction revises the first record at the second interval while retaining publication time and URL. Conflicting reports keep independent IDs and URLs and opposing headlines. Missing quotes returns identities with no price. Rate limits throw a typed error with a clock-derived retry timestamp; outages throw without pretending success. Tests can change `scenario` on an instance to simulate failure and recovery; restore the original scenario before resuming its checkpoint.

## Failure and browser behavior

`DATA_MODE` must explicitly be `mock` or `live`; missing, empty and unknown values fail validation. The API/worker examples select mock. Browser flags never override server mode. `selectProviders('live')` requires actual live adapters and rejects mock identities. At this milestone `/api/market` in live mode returns an authenticated, no-store `unavailable/not_configured` snapshot with empty data. There is no fallback to mocks. Live configuration retains the existing PostgreSQL/Redis prerequisites.

The process-local snapshot service serializes overlapping polls, retains twenty latest normalized articles, coalesces duplicate source IDs and replaces older revisions. Checkpoints advance only after complete response validation. A provider failure returns cached data as **stale immediately**, preserving quote/article/provider/ingestion/fetch timestamps; without a prior successful snapshot it returns unavailable. Error text is sanitized to typed codes. This cache contains public market samples only; portfolios and sessions are still ownership-protected and authoritative in PostgreSQL. The route authenticates before touching providers. Durable ingestion, canonical-URL dedupe/history and persisted checkpoint/cache recovery belong to milestones 12–13.

The workspace banner, sidebar, News and Settings display server-selected mode and freshness. News shows synthetic/delayed labels, revisions, source, publication/provider/ingestion timestamps and canonical links. Old article timestamps are labeled stale separately from a healthy fresh snapshot. Browser request failures label retained values stale. News includes quote samples and missing quotes. These samples do **not** replace persisted portfolio quotes: holdings keep the valuation policy and per-holding labels from milestone 09. The Assistant stays the credential-free mock unless independently configured for Claude.

## Demonstrate without external credentials

Use the migrated/seeded local database from milestone 10. No market-data, AI or Entra credentials are needed. From the root:

```powershell
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:MOCK_NEWS_INTERVAL_MS='1000'
$env:MOCK_SCENARIO='ordinary'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
$env:ANTHROPIC_API_KEY=''
$env:ENTRA_CLIENT_ID=''
$env:ENTRA_CLIENT_SECRET=''
$env:ENTRA_TENANT_ID=''
npm run dev
```

Open http://127.0.0.1:5173/news, sign in as Alice Demo and wait for the five-second browser poll. Expect MOCK DATA, Fresh, Synthetic, delayed labels and new numbered headlines. Open Settings to inspect the configured interval. Restart with `MOCK_SCENARIO=corrections`, `duplicates`, `conflicts`, `missing_quotes`, `rate_limit` or `outage` to inspect the corresponding fixture. For live absence, set `DATA_MODE=live` and `REDIS_URL=redis://127.0.0.1:6379`, restart and observe LIVE DATA / unavailable / not configured with no manufactured quotes or news.

## Verification and reuse

```powershell
npm run typecheck
npm run build
npm run check:browser-boundary
$env:DATA_MODE='mock'
$env:PORTFOLIO_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
$env:AUTH_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m07_auth_verify'
npm run test
# With the demonstration servers running and Chrome installed:
$env:PORTFOLIO_E2E_DATABASE_URL=$env:PORTFOLIO_TEST_DATABASE_URL
npm run test:browser --workspace @portfolio-pilot/web
```

`packages/providers/test/provider-contract.ts` exports `providerContract(name, setup)`. Later live adapter tests should import it with a recorded transport and fixed clock, a known and unknown security, and at least two ordinary news records. The harness checks decimal prices, missing identities, provenance, timestamps, timeliness/synthetic flags, canonical URLs, bounded page continuation, checkpoint resume and foreign checkpoint rejection. Live network acceptance is separate from these reproducible contracts. The mock suite adds interval boundaries, identical replay, duplicate/correction/conflict fixtures, outages, rate limits and mode rejection. Snapshot tests cover timestamp-preserving stale cache and recovery. PostgreSQL acceptance verifies authenticated market access and actual live-unavailable route behavior. Chrome acceptance uses actual mock API responses for scheduled news, then intercepted stale/live-unavailable responses to check browser labels and absence of fabricated articles.

Route Handler APIs were checked against installed Next.js 16.3.8 documentation and the [official reference](https://nextjs.org/docs/app/api-reference/file-conventions/route); polling options against installed TanStack Query definitions. No dependency upgrades or external provider choice occurred. The lockfile changes only record the API's existing local providers workspace dependency.

See `docs/project-state.md` for actual checks. In-memory snapshots/resetting process epochs, no live adapter, no worker ingestion, no durable news history and no provider-backed portfolio valuation are intentional boundaries of this slice.
