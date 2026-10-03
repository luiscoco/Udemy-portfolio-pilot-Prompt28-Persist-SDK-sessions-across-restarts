# 21 - Portfolio impact and research recommendations

## What the learner builds

One public article classification is reusable by many owners. Its portfolio relevance and research
recommendations are calculated afterwards from authorized holdings. Compare Alice's concentrated
holding with Bob's diversified holding and a watchlist-only owner: identical reporting should not yield
identical advice. Design and full invalidation policy: [ADR 0014](../decisions/0014-shared-analysis-private-research.md).

## Trace the implementation

1. Contracts in `packages/contracts/src/research.ts` separate shared analysis from private impact.
2. `packages/agent/src/article-analysis.ts` validates structure, exact source ID/URL, linked symbols,
   and prohibited text. `ClaudeArticleAnalyzer` uses the existing SDK with no tools or persisted session.
3. `packages/db/src/research-service.ts` claims/reuses the PostgreSQL cache. Only headline/summary,
   source metadata and linked symbols go to the analyzer. No holdings enter a shared key or model prompt.
4. `packages/domain/src/exposure.ts` computes exact decimal weights. Fresh quotes for every open
   position permit market-value weights; otherwise all weights use cost basis. Never mix denominators.
5. `packages/domain/src/research.ts` generates deterministic research steps with evidence, caveats,
   counterarguments and timestamps. Reporting tone is not a forecast or probability.
6. The owner-scoped API exposes GET/POST `/api/news/:id/impact` and GET `/api/recommendations`.
   GET never calls the model. POST ensures the shared analysis then refreshes private calculations.
7. News detail displays the persisted research, evidence freshness and recalculation control. SSE
   refreshes impact reads after holdings/watchlist changes and corrections, including cited other articles.

## Cache identity and provenance

The shared key includes article identity/revision, prompt/schema version and model configuration.
Publication time, URL, accepted provider, synthetic flag and linked symbols belong to revision identity.
Delivery IDs and arrival time do not. Database claims, lease renewal and fenced completion avoid model
runs for concurrent duplicates. Failed outputs are cached with a ten-minute retry delay.

Private records use an authenticated owner, immutable ledger fingerprint, generator version and cited
analysis IDs/revisions. Same net quantity does not mean the portfolio is unchanged: selling one share
and buying it back at another price changes cost basis. Include immutable transaction IDs in invalidation.

Corrections mark citing recommendations stale in the ingestion transaction. Portfolio and version
changes are checked on every read. Recalculation supersedes old records. Evidence older than 72 hours
is labeled aged, and corrected evidence is labeled individually. A correction to one source does not
make every other cited source corrected.

Weights are as-of snapshots. Quotes changing later do not silently rewrite existing recommendations.
Explicit recalculation refreshes weights and can reuse the same article analysis. Opposing reports are
compared only when their shared analysis already exists; generating one analysis does not fan out model calls.

## Demonstrate locally

From the repository root in PowerShell, with existing local PostgreSQL/Redis:

```powershell
$env:NODE_ENV='development'
$env:ALLOW_DEMO_SEED='true'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:REDIS_URL='redis://127.0.0.1:6379'
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://127.0.0.1:5173'
npm run migrate:deploy --workspace @portfolio-pilot/db
npm run seed:demo --workspace @portfolio-pilot/db
npm run dev
```

Open `http://127.0.0.1:5173/news`, sign in as Alice, open a seeded synthetic article, and press
**Analyze impact**. Seeded neutral articles may correctly show **No research action suggested**.
Press **Recalculate impact**: the shared analysis is reused. Record a holding change from Portfolio,
return to the article, and observe the out-of-date state before recalculation.

The acceptance tests create material, contradictory and neutral fixtures without modifying demo data:

```powershell
$env:RESEARCH_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m21_verify'
npm exec --workspace @portfolio-pilot/api -- vitest run lib/research.integration.test.ts
```

For Chrome, stop any other dev servers and start `npm run dev` with the same `DATABASE_URL` as
the verification database and `AUTH_BASE_URL=http://127.0.0.1:5173`, retaining mock/demo settings.
In another terminal:

```powershell
$env:RESEARCH_E2E_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m21_verify'
npm exec --workspace @portfolio-pilot/web -- playwright test e2e/research.spec.ts --workers=1
```

It creates a private material fixture, uses the real API, checks persisted recommendations/caveats,
aged evidence, mobile overflow, shared analysis count and Bob's 404s, then removes its own fixtures.

## Checks performed

- `npm run typecheck`: all workspaces passed.
- `DATA_MODE=mock; npm run test`: 242 passed; 68 infrastructure tests skipped in the opt-in-free run.
- PostgreSQL research acceptance: 11/11 passed on `portfolio_m21_verify` after final service rebuild.
- All 11 migrations applied from empty on `portfolio_m21_schema_20261002`.
- `npm run build`: all workspaces passed with existing Vite directive and Next Edge warnings.
- `npm run check:browser-boundary`: passed.
- Chrome research acceptance: 1/1 passed; mobile screenshot in `apps/web/test-results/research-mobile.png`.

An initial accepted-provider freshness assertion incorrectly required all evidence to be corrected,
including unrelated citations; it now checks the changed article. The first Chrome run queried Bob's
API before sign-in completed (401); the test now waits for his authenticated session before checking 404.

## Exercise and common mistakes

Exercise: add a third portfolio without the affected security. Check that aggregate weight decreases
while the affected holding's per-portfolio weight stays the same. Then make one quote stale: every
weight should use cost basis on explicit recalculation.

Common mistakes: putting portfolio data in the public model prompt; ignoring model/schema versions
in keys; treating repeated deliveries as revisions; trusting the first provider after a correction;
using floating point; calling tone a price forecast; hiding stale evidence; or letting a sell/rebuy
evade invalidation. Primary-source suggestions must not invent an uncited URL.

## Limits and next step

Live Claude remains unverified without credentials. Set server-only `ANTHROPIC_API_KEY`,
`AGENT_MODE=claude`, `AGENT_MODEL_ID` and `AGENT_WORKSPACE_DIR`, run `npm run dev`, and press
**Analyze impact** on a supported material article to check live latency, cost and structured output.
The keyword mock is a teaching fixture, not a semantic analyzer. Source validation cannot prove the
truth of a paraphrase. Process restart can interrupt an in-flight analysis; a later request reclaims
its expired lease. Durable jobs follow in milestone 27. Save/dismiss, history controls and configurable
alerts follow in milestone 22. No dependencies were upgraded, no trades executed, and nothing deployed.
