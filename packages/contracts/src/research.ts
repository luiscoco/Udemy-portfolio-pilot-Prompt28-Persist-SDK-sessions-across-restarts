import { z } from 'zod';
import { newsEventCategorySchema } from './news-analysis.js';
import { recommendationDispositionSchema } from './alerts.js';

/**
 * Milestone 21: portfolio impact and research recommendations.
 *
 * Two layers with different audiences:
 * - `ArticleAnalysis` is SHARED and user-independent. It is produced from public article fields only
 *   and cached by article revision + prompt version + schema version + model configuration.
 * - Exposure, relevance and `Recommendation`s are PRIVATE. They combine a shared analysis with one
 *   owner's authorized holdings and are stored only under that owner.
 */
export const ARTICLE_ANALYSIS_SCHEMA_VERSION = 'article-analysis-v1' as const;
/** Tone of the reporting. It is NOT a forecast and NOT a calibrated probability. */
export const SENTIMENT_LABELS = ['positive', 'negative', 'mixed', 'neutral'] as const;
export const SENTIMENT_NOTE = 'Sentiment describes the tone of the reporting. It is not a forecast or a calibrated probability.' as const;

const articleId = z.string().min(1).max(128);
const statement = z.string().trim().min(1).max(400);
const symbol = z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,31}$/);

/** What the analyzer must return. The server validates it again against the analyzed article. */
export const articleAnalysisSchema = z.object({
  schemaVersion: z.literal(ARTICLE_ANALYSIS_SCHEMA_VERSION),
  articleId,
  eventCategories: z.array(newsEventCategorySchema).min(1).max(5),
  /** "high" is deliberately not representable: one article never establishes a large effect. */
  materiality: z.enum(['none', 'low', 'medium']),
  sentiment: z.object({ label: z.enum(SENTIMENT_LABELS), rationale: statement }).strict(),
  /** Attributed reporting ("The article reports ..."), not the analyzer's own claims. */
  keyFacts: z.array(z.object({ statement }).strict()).min(1).max(6),
  mentionedSymbols: z.array(symbol).max(10),
  uncertainties: z.array(statement).min(1).max(6),
  counterpoints: z.array(statement).max(6),
  primarySource: z.object({ recommended: z.boolean(), reason: statement }).strict(),
  /** Must be exactly the analyzed article; any other source is rejected. */
  sources: z.array(z.object({ articleId, url: z.string().max(2048) }).strict()).min(1).max(5)
}).strict();
export type ArticleAnalysis = z.infer<typeof articleAnalysisSchema>;

export const ARTICLE_ANALYSIS_FAILURE_CODES = ['unsupported_source', 'analysis_invalid_structure', 'analysis_unknown_source', 'analysis_prohibited_content', 'analysis_no_output', 'analysis_failed'] as const;
export type ArticleAnalysisFailureCode = (typeof ARTICLE_ANALYSIS_FAILURE_CODES)[number];

/** Public, shareable view of a cached analysis with its provenance. Never contains owner data. */
export const sharedArticleAnalysisSchema = z.object({
  id: z.string(), articleId, revisionKey: z.string().regex(/^[0-9a-f]{64}$/), observationId: z.string().nullable(),
  promptVersion: z.string(), schemaVersion: z.string(), modelKey: z.string(), analyzerMode: z.enum(['mock', 'claude']),
  status: z.enum(['pending', 'completed', 'failed']), failureCode: z.enum(ARTICLE_ANALYSIS_FAILURE_CODES).nullable(), attempts: z.number().int().nonnegative(),
  analysis: articleAnalysisSchema.nullable(),
  source: z.object({ url: z.string(), provider: z.string(), title: z.string(), publishedAt: z.iso.datetime(), isSynthetic: z.boolean() }).strict(),
  createdAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(), supersededAt: z.iso.datetime().nullable()
}).strict();
export type SharedArticleAnalysis = z.infer<typeof sharedArticleAnalysisSchema>;

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
export const exposureBasisSchema = z.enum(['market_value', 'cost_basis']);
export const exposureHoldingSchema = z.object({
  securityId: z.string(), symbol: z.string(), exchangeMic: z.string(), portfolioId: z.string(), portfolioName: z.string(),
  quantity: decimal, value: decimal, valueBasis: exposureBasisSchema,
  /** Fraction of the holding's portfolio on the same basis; null when the portfolio total is zero. */
  weight: decimal.nullable(), quoteStatus: z.enum(['fresh', 'stale', 'missing', 'invalid', 'not_required'])
}).strict();
export const articleExposureSchema = z.object({
  relevance: z.enum(['held', 'watchlisted', 'none']), basis: exposureBasisSchema.nullable(),
  affectedValue: decimal, totalValue: decimal, weight: decimal.nullable(), largestHoldingWeight: decimal.nullable(),
  holdings: z.array(exposureHoldingSchema),
  portfolios: z.array(z.object({ portfolioId: z.string(), name: z.string(), affectedValue: decimal, totalValue: decimal, weight: decimal.nullable() }).strict()),
  watchlistedSecurityIds: z.array(z.string()), concentrationThreshold: decimal
}).strict();
export type ArticleExposure = z.infer<typeof articleExposureSchema>;

export const RECOMMENDATION_TYPES = ['monitor_event', 'review_concentration', 'read_primary_source', 'reassess_assumptions'] as const;
export const recommendationTypeSchema = z.enum(RECOMMENDATION_TYPES);
export type RecommendationType = z.infer<typeof recommendationTypeSchema>;
export const STALE_REASONS = ['article_corrected', 'article_withdrawn', 'portfolio_changed', 'analysis_version_changed'] as const;
export const staleReasonSchema = z.enum(STALE_REASONS);
export type StaleReason = z.infer<typeof staleReasonSchema>;
/** Evidence freshness is computed when read: a stored revision can be overtaken or simply age. */
export const evidenceStatusSchema = z.enum(['current', 'corrected', 'aged', 'unavailable']);

export const recommendationEvidenceSchema = z.object({
  articleId, analysisId: z.string(), title: z.string(), url: z.string(), publishedAt: z.iso.datetime(),
  revisionKey: z.string(), statement: z.string(), status: evidenceStatusSchema.default('current')
}).strict();
export const recommendationSchema = z.object({
  disposition: recommendationDispositionSchema.default('new'),
  id: z.string(), articleId, type: recommendationTypeSchema,
  status: z.enum(['active', 'stale', 'superseded']), staleReasons: z.array(staleReasonSchema),
  title: z.string(), rationale: z.string(),
  evidence: z.array(recommendationEvidenceSchema).min(1), affectedHoldings: z.array(exposureHoldingSchema),
  affectedSecurities: z.array(z.object({ securityId: z.string(), symbol: z.string(), relation: z.enum(['held', 'watchlisted']) }).strict()),
  uncertainties: z.array(z.string()).min(1), counterarguments: z.array(z.string()).min(1),
  sentiment: z.object({ label: z.enum(SENTIMENT_LABELS), note: z.literal(SENTIMENT_NOTE) }).strict(),
  asOf: z.iso.datetime(), createdAt: z.iso.datetime(),
  provenance: z.object({ generatorVersion: z.string(), analysisIds: z.array(z.string()), promptVersion: z.string(), schemaVersion: z.string(), modelKey: z.string(), portfolioFingerprint: z.string(), exposureBasis: exposureBasisSchema.nullable() }).strict()
}).strict();
export type Recommendation = z.infer<typeof recommendationSchema>;
export type RecommendationEvidence = z.infer<typeof recommendationEvidenceSchema>;

/**
 * Per-owner impact of one article. `state` is honest about what exists:
 * not_analyzed (nothing computed yet), current, stale (inputs changed since), unsupported_source
 * (the article cannot be used as evidence), analysis_failed (the shared analysis was rejected), pending.
 */
export const articleImpactSchema = z.object({
  articleId, state: z.enum(['not_analyzed', 'pending', 'current', 'stale', 'unsupported_source', 'analysis_failed']),
  staleReasons: z.array(staleReasonSchema), failureCode: z.enum(ARTICLE_ANALYSIS_FAILURE_CODES).nullable(),
  analysis: sharedArticleAnalysisSchema.nullable(), exposure: articleExposureSchema.nullable(),
  recommendations: z.array(recommendationSchema), computedAt: z.iso.datetime().nullable(),
  /** True when the run reused a cached shared analysis instead of calling the model. */
  analysisReused: z.boolean().nullable(),
  policy: z.object({ evidenceAgedAfterMs: z.number().int().positive(), concentrationThreshold: decimal, generatorVersion: z.string() }).strict()
}).strict();
export type ArticleImpact = z.infer<typeof articleImpactSchema>;
export const articleImpactResultSchema = z.object({ impact: articleImpactSchema });

export const recommendationListQuerySchema = z.object({
  status: z.enum(['active', 'stale', 'open', 'history', 'saved']).default('open'), limit: z.coerce.number().int().min(1).max(50).default(20)
}).strict();
export const recommendationListSchema = z.object({ recommendations: z.array(recommendationSchema), generatedAt: z.iso.datetime() });
