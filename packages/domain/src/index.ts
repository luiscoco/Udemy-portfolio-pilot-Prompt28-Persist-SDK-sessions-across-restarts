/** Money and quantity cross the API as decimal strings, never JS numbers. */
export type DecimalString = string;
export { matchesAlert } from './alerts.js';
export { largestHolding } from './largest-holding.js';
export type Currency = 'USD';
export { validateLongOnlyLedger, quantityUnits } from './ledger.js';
export { calculatePortfolioSummary } from './valuation.js';
export type { ValuationTrade, ValuationQuote } from './valuation.js';
export { classifyQuote, combinePortfolioTotals, valuationCoverage, QUOTE_STALE_AFTER_MS } from './portfolio-facts.js';
export type { QuoteStatus, QuoteLike, PortfolioTotalsInput, CoveragePosition } from './portfolio-facts.js';
export { articleExposure, atOrAbove, EXPOSURE_POLICY } from './exposure.js';
export type { ArticleExposureResult, ExposureBasis, ExposureHolding, ExposurePortfolio, ExposurePosition } from './exposure.js';
export { evidenceSource, generateRecommendations, prohibitedContent, validateRecommendation, RESEARCH_POLICY, SUPPORTED_EVIDENCE_PROVIDERS } from './research.js';
export type { AnalyzedArticle, EvidenceSourceDecision, Materiality, RecommendationDraft, RecommendationKind, RecommendationValidation, Sentiment } from './research.js';
