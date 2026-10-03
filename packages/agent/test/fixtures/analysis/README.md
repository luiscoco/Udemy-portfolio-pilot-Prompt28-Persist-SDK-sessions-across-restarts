# Structured news-analysis fixtures (`news-analysis-v1`)

Untrusted `structured_output` values for `validateNewsAnalysis`. They reference the fake tool state
in `../../fixtures.ts`: articles `a1` and `a2` (URLs `https://example.invalid/<id>`, published 30 and
90 minutes before the fixed clock `2026-10-02T12:00:00Z`), both linked to `sec-nova` (NOVA), which the
user holds. Only articles read with `getNewsArticle` in the same run are known sources.

| File | Expected result |
| --- | --- |
| `valid.json` | Accepted; the invented title for `a1` is replaced by the tool's title |
| `invalid-structure.json` | `analysis_invalid_structure`: bad `asOf`, unknown category, `high` confidence, no uncertainties, extra `priceTarget` |
| `missing-references.json` | `analysis_missing_references`: claims with no article, a cited article not listed and without an evidence link |
| `unknown-source.json` | `analysis_unknown_source`: an invented article ID, a URL that is not the article's, a security not linked to the cited article |

All content is fictional.
