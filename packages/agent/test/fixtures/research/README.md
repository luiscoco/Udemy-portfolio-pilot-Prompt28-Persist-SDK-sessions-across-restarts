# Milestone 21 research fixtures

These are fictional teaching scenarios, not current investment evidence. Tests replace `ACME` with
isolated security IDs/symbols and derive publication times from a controlled/current test clock.

- `contradictory-articles.json`: opposite guidance reports for one security within seven days. The
  concentrated holder, diversified holder and watcher have different expected recommendation sets.
- `neutral-news.json`: descriptive, immaterial news yields neutral tone and no research action.
- `unsupported-source.json`: unknown provider rejection before model execution, and rejection of an
  extra model-supplied source even when another source is valid.
- `prohibited-content.json`: price-target wording fails validation rather than becoming a recommendation.

`packages/agent/test/article-analysis.test.ts` exercises classification/validation and deterministic
generation. `apps/api/lib/research.integration.test.ts` persists them against PostgreSQL with owner
isolation, correction invalidation, duplicate deliveries, failure backoff and aged evidence.
