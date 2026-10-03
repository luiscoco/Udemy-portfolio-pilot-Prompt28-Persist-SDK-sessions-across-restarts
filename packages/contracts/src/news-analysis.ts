import { z } from 'zod';

/**
 * Structured news analysis (milestone 20). This schema is the contract for BOTH the JSON Schema the
 * SDK enforces through `outputFormat` and the server-side validation that runs afterwards. Schema
 * validity is necessary but not sufficient: the server also checks that every article ID and
 * evidence link was actually read by this run (see `validateNewsAnalysis` in @portfolio-pilot/agent).
 */
export const NEWS_ANALYSIS_SCHEMA_VERSION = 'news-analysis-v1' as const;
export const NEWS_EVENT_CATEGORIES = ['earnings', 'guidance', 'merger_acquisition', 'regulatory_legal', 'product', 'management', 'capital_markets', 'macro', 'analyst_rating', 'operations', 'other'] as const;
export const newsEventCategorySchema = z.enum(NEWS_EVENT_CATEGORIES);
export type NewsEventCategory = z.infer<typeof newsEventCategorySchema>;

const articleId = z.string().min(1).max(128);
/** References are plain lists here; the server requires at least one for every factual claim. */
const references = z.array(articleId).max(10);
const statement = z.string().trim().min(1).max(600);

export const newsAnalysisSchema = z.object({
  schemaVersion: z.literal(NEWS_ANALYSIS_SCHEMA_VERSION),
  /** UTC time the analysis describes; no cited article may be published after it. */
  asOf: z.iso.datetime(),
  articles: z.array(z.object({ articleId, title: z.string().max(500), publishedAt: z.iso.datetime() }).strict()).min(1).max(10),
  events: z.array(z.object({ category: newsEventCategorySchema, description: statement, articleIds: references }).strict()).max(10),
  affectedSecurities: z.array(z.object({
    securityId: z.string().min(1).max(128), symbol: z.string().min(1).max(32),
    relation: z.enum(['held', 'watchlisted', 'mentioned']), articleIds: references
  }).strict()).max(20),
  factualSummary: z.array(z.object({ statement, articleIds: references }).strict()).min(1).max(10),
  /** Possibilities supported by cited facts. "high" confidence is deliberately not representable. */
  interpretations: z.array(z.object({ statement, confidence: z.enum(['low', 'medium']), articleIds: references }).strict()).max(10),
  uncertainties: z.array(z.object({ statement, articleIds: references }).strict()).min(1).max(10),
  evidence: z.array(z.object({ articleId, url: z.string().max(2048) }).strict()).min(1).max(10)
}).strict();
export type NewsAnalysis = z.infer<typeof newsAnalysisSchema>;

/** Typed failures of an analysis run; persisted as the run failure code. */
export const ANALYSIS_FAILURE_CODES = ['analysis_invalid_structure', 'analysis_missing_references', 'analysis_unknown_source', 'analysis_no_output', 'analysis_retries_exhausted'] as const;
export type AnalysisFailureCode = (typeof ANALYSIS_FAILURE_CODES)[number];
