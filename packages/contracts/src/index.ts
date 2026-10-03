import { z } from 'zod';
export * from './chat.js';
export * from './agent-events.js';
export * from './news-analysis.js';
export * from './research.js';
import { agentEventPayloadShapes, agentEventCommonShape, type AgentEventType } from './agent-events.js';
export { agentRunChunksSchema, browserEventSchema, type BrowserEvent } from './browser-events.js';

export const correlationIdSchema = z.uuid();
export const ERROR_CODES = ['BAD_REQUEST', 'CONFLICT', 'BUDGET_EXHAUSTED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL_ERROR', 'CONFIGURATION_ERROR'] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export const errorEnvelopeSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string().min(1), requestId: correlationIdSchema })
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export const REQUEST_ID_HEADER = 'x-request-id' as const;
export const HEALTH_STATUS = 'ok' as const;
export const healthResponseSchema = z.object({ status: z.literal(HEALTH_STATUS), requestId: correlationIdSchema });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// Browser-safe read models. Financial values stay decimal strings; the server will
// calculate them when portfolio APIs arrive in later milestones.
export const holdingDtoSchema = z.object({
  symbol: z.string(), name: z.string(), sector: z.string(), shares: z.string(),
  price: z.string(), marketValue: z.string(), dayChangePercent: z.string(),
  allocationPercent: z.string(), trend: z.enum(['up', 'down', 'flat'])
});
export type HoldingDto = z.infer<typeof holdingDtoSchema>;
export const portfolioDtoSchema = z.object({
  id: z.string(), name: z.string(), accountLabel: z.string(),
  totalValue: z.string(), dayChange: z.string(), dayChangePercent: z.string(),
  totalReturn: z.string(), totalReturnPercent: z.string(), cashBalance: z.string(),
  holdings: z.array(holdingDtoSchema), asOf: z.string(), isDemo: z.boolean()
});
export type PortfolioDto = z.infer<typeof portfolioDtoSchema>;
export const newsItemDtoSchema = z.object({
  id: z.string(), category: z.string(), title: z.string(), summary: z.string(),
  source: z.string(), publishedAt: z.string(), symbols: z.array(z.string()),
  url: z.url(), isDemo: z.boolean()
});
export type NewsItemDto = z.infer<typeof newsItemDtoSchema>;
export const watchlistItemDtoSchema = z.object({
  symbol: z.string(), name: z.string(), price: z.string(),
  dayChangePercent: z.string(), trend: z.enum(['up', 'down', 'flat'])
});
export type WatchlistItemDto = z.infer<typeof watchlistItemDtoSchema>;

// Persisted ledger DTOs: fixed-point values cross JSON only as decimal strings.
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/);
export const securityIdentitySchema = z.object({
  symbol: z.string().min(1).max(32), exchangeMic: z.string().regex(/^[A-Z0-9]{4}$/), currency: z.literal('USD')
});
export const portfolioTransactionDtoSchema = z.object({
  id: z.string(), portfolioId: z.string(), securityId: z.string(),
  side: z.enum(['BUY', 'SELL']), quantity: decimalStringSchema,
  price: decimalStringSchema, fees: decimalStringSchema, amount: decimalStringSchema,
  occurredAt: z.iso.datetime(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  security: securityIdentitySchema
});
export type PortfolioTransactionDto = z.infer<typeof portfolioTransactionDtoSchema>;

const summaryPositionSchema = z.object({
  securityId: z.string(), security: securityIdentitySchema,
  remainingQuantity: decimalStringSchema, weightedAverageAcquisitionCost: decimalStringSchema.nullable(),
  remainingCostBasis: decimalStringSchema, soldCostBasis: decimalStringSchema, realizedGainLoss: decimalStringSchema,
  marketValue: decimalStringSchema.nullable(), unrealizedGainLoss: decimalStringSchema.nullable(),
  allocationWeight: decimalStringSchema.nullable(),
  quoteStatus: z.enum(['fresh', 'stale', 'missing', 'invalid', 'not_required']),
  quote: z.object({ securityId: z.string(), price: z.string(), currency: z.string(), asOf: z.iso.datetime(), provider: z.string(), isSynthetic: z.boolean() }).nullable()
});
export const portfolioSummarySchema = z.object({
  portfolioId: z.string(), name: z.string(), currency: z.literal('USD'), asOf: z.iso.datetime(), staleAfterMs: z.number().int().nonnegative(),
  valuationComplete: z.boolean(), remainingCostBasis: decimalStringSchema, soldCostBasis: decimalStringSchema, realizedGainLoss: decimalStringSchema,
  marketValue: decimalStringSchema.nullable(), unrealizedGainLoss: decimalStringSchema.nullable(), positions: z.array(summaryPositionSchema)
});
export type PortfolioSummary = z.infer<typeof portfolioSummarySchema>;

// Match numeric(28,10) without allowing implicit database rounding or exponent syntax.
const tradeDecimalSchema = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,10})?$/);
const positiveTradeDecimalSchema = tradeDecimalSchema.refine(value => /[1-9]/.test(value), 'Must be positive');
export const portfolioCreateSchema = z.object({ name: z.string().trim().min(1).max(100), currency: z.literal('USD').default('USD') }).strict();
export const portfolioEditSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const transactionCreateSchema = z.object({
  security: securityIdentitySchema.extend({ symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,31}$/) }).strict(),
  side: z.enum(['BUY', 'SELL']), quantity: positiveTradeDecimalSchema,
  price: positiveTradeDecimalSchema, fees: tradeDecimalSchema.default('0'),
  occurredAt: z.iso.datetime({ precision: 3 }).refine(value => Number.isFinite(Date.parse(value)), 'Invalid date')
}).strict();
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const transactionPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0)
}).strict();
export type TransactionCreate = z.infer<typeof transactionCreateSchema>;

export const portfolioRecordSchema = z.object({ id: z.string(), name: z.string(), currency: z.literal('USD'), archivedAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const portfolioListSchema = z.object({ portfolios: z.array(portfolioRecordSchema) });
export const portfolioResultSchema = z.object({ portfolio: portfolioRecordSchema });
export const transactionHistorySchema = z.object({ transactions: z.array(portfolioTransactionDtoSchema), nextOffset: z.number().int().nullable() });
export const transactionResultSchema = z.object({ transaction: portfolioTransactionDtoSchema, replayed: z.boolean() });
export const securityOptionSchema = securityIdentitySchema.extend({ id: z.string(), name: z.string() });
export const securityListSchema = z.object({ securities: z.array(securityOptionSchema) });
export const watchlistWriteSchema = z.object({ securityId: z.string().min(1) }).strict();
export const watchlistEntrySchema = z.object({ id: z.string(), security: securityOptionSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const watchlistListSchema = z.object({ entries: z.array(watchlistEntrySchema) });
export const watchlistResultSchema = z.object({ entry: watchlistEntrySchema });
export type PortfolioRecord = z.infer<typeof portfolioRecordSchema>;
export const portfolioSummaryResultSchema = z.object({ summary: portfolioSummarySchema });
export const watchlistRemovalSchema = z.object({ removed: z.literal(true) });

// Normalized market snapshots only; raw provider payloads remain server-side.
export const marketProvenanceSchema = z.object({
  sourceId: z.string().min(1), sourceRecordId: z.string().min(1), providerAt: z.iso.datetime(), ingestedAt: z.iso.datetime(),
  isDelayed: z.boolean(), delayMs: z.number().int().nonnegative(), isSynthetic: z.boolean()
});
export const marketQuoteSchema = marketProvenanceSchema.extend({ security: z.object({ symbol: z.string(), exchangeMic: z.string() }), price: decimalStringSchema, currency: z.string() });
export const marketArticleSchema = marketProvenanceSchema.extend({ canonicalUrl: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)), publishedAt: z.iso.datetime(), revision: z.number().int().positive(), title: z.string(), summary: z.string(), category: z.string(), symbols: z.array(z.string()) });
export const marketSnapshotSchema = z.object({
  mode: z.enum(['mock', 'live']), status: z.enum(['fresh', 'stale', 'unavailable']), asOf: z.iso.datetime(),
  fetchedAt: z.iso.datetime().nullable(), staleAfterMs: z.number().int().positive(), intervalMs: z.number().int().positive(),
  error: z.enum(['rate_limit', 'outage', 'not_configured']).nullable(), retryAt: z.iso.datetime().nullable(),
  providers: z.array(z.object({ sourceId: z.string(), kind: z.enum(['quotes', 'news']), delivery: z.enum(['polling', 'push']), timeliness: z.enum(['delayed', 'real-time']), delayMs: z.number().int().nonnegative() })),
  quotes: z.array(marketQuoteSchema), missing: z.array(z.object({ symbol: z.string(), exchangeMic: z.string() })), articles: z.array(marketArticleSchema)
});
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;

// Application events (milestone 13). The UUID is the stable domain identity; Redis stream entry IDs
// are delivery cursors and never appear inside the envelope. Delivery is at-least-once.
export const APP_EVENT_SCHEMA_VERSION = 1 as const;
const eventBase = {
  id: z.uuid(), schemaVersion: z.literal(APP_EVENT_SCHEMA_VERSION), occurredAt: z.iso.datetime(),
  entityId: z.string().min(1), portfolioId: z.string().min(1).nullable()
};
const userAudience = z.object({ kind: z.literal('user'), userId: z.string().min(1) }).strict();
const marketAudience = z.object({ kind: z.literal('market') }).strict();
// Internal events are handled server-side by the dispatcher and are never published to a stream.
const systemAudience = z.object({ kind: z.literal('system') }).strict();
export const portfolioUpdatedEventSchema = z.object({ ...eventBase, type: z.literal('portfolio.updated'), audience: userAudience, entityType: z.literal('portfolio'),
  payload: z.object({ change: z.enum(['created', 'renamed', 'archived', 'transaction.recorded']), transactionId: z.string().nullable() }).strict() }).strict();
export const watchlistUpdatedEventSchema = z.object({ ...eventBase, type: z.literal('watchlist.updated'), audience: userAudience, entityType: z.literal('watchlist_entry'),
  payload: z.object({ change: z.enum(['added', 'changed', 'removed']), securityId: z.string().nullable() }).strict() }).strict();
export const newsAvailableEventSchema = z.object({ ...eventBase, type: z.literal('news.available'), audience: userAudience, entityType: z.literal('news_article'),
  payload: z.object({ change: z.enum(['new', 'correction']), securityIds: z.array(z.string()), portfolioIds: z.array(z.string()), watchlisted: z.boolean(), sourceEventId: z.uuid() }).strict() }).strict();
export const quoteUpdatedEventSchema = z.object({ ...eventBase, type: z.literal('quote.updated'), audience: marketAudience, entityType: z.literal('quote_batch'),
  payload: z.object({ quotes: z.array(z.object({ securityId: z.string(), asOf: z.iso.datetime() }).strict()).min(1) }).strict() }).strict();
export const newsIngestedEventSchema = z.object({ ...eventBase, type: z.literal('news.article.ingested'), audience: systemAudience, entityType: z.literal('news_article'),
  payload: z.object({ change: z.enum(['new', 'correction']), securityIds: z.array(z.string()) }).strict() }).strict();
// Transient agent-run progress (milestone 19): owner-only stream entries keyed by run ID. Durable
// run outcomes and completed messages live in PostgreSQL; these entries only notify.
function agentAppEvent<T extends AgentEventType>(type: T) {
  return z.object({ ...eventBase, type: z.literal(type), audience: userAudience, entityType: z.literal('agent_run'), portfolioId: z.null(),
    payload: z.object({ ...agentEventCommonShape, ...agentEventPayloadShapes[type] }).strict() }).strict();
}
export const agentAppEventSchemas = [agentAppEvent('agent.run.started'), agentAppEvent('agent.text.delta'), agentAppEvent('agent.block.completed'),
  agentAppEvent('agent.tool.status'), agentAppEvent('agent.message.completed'), agentAppEvent('agent.run.completed')] as const;
export const researchUpdatedEventSchema = z.object({ ...eventBase, type: z.literal('research.updated'), audience: userAudience, entityType: z.literal('research'),
  payload: z.object({ change: z.enum(['recommendation.created', 'recommendation.updated', 'notification.created', 'notification.dismissed', 'rule.updated']) }).strict() }).strict();
export const appEventSchema = z.discriminatedUnion('type', [researchUpdatedEventSchema, portfolioUpdatedEventSchema, watchlistUpdatedEventSchema, newsAvailableEventSchema, quoteUpdatedEventSchema, newsIngestedEventSchema, ...agentAppEventSchemas]);
export type AppEvent = z.infer<typeof appEventSchema>;
export type AppEventType = AppEvent['type'];
export type AgentAppEvent = Extract<AppEvent, { entityType: 'agent_run' }>;
export const isAgentAppEvent = (event: AppEvent): event is AgentAppEvent => event.entityType === 'agent_run';

// Cached read models. generatedAt is when PostgreSQL produced the value, so cached age stays visible.
export const cachedQuoteSchema = z.object({ securityId: z.string(), price: decimalStringSchema, currency: z.string(), asOf: z.iso.datetime(), provider: z.string(), isSynthetic: z.boolean() });
export const quoteListSchema = z.object({ quotes: z.array(cachedQuoteSchema), missing: z.array(z.string()), servedAt: z.iso.datetime() });
export const newsFeedItemSchema = z.object({
  id: z.string(), provider: z.string(), title: z.string(), summary: z.string(), url: z.string(), publishedAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  isSynthetic: z.boolean(), securities: z.array(z.object({ id: z.string(), symbol: z.string(), exchangeMic: z.string() })),
  ingestedAt: z.iso.datetime().optional(), providerAt: z.iso.datetime().nullable().default(null),
  source: z.string().optional(), revision: z.number().int().positive().default(1),
  isDelayed: z.boolean().nullable().default(null), delayMs: z.number().int().nonnegative().nullable().default(null),
  readAt: z.iso.datetime().nullable().default(null), readRevisionAt: z.iso.datetime().nullable().default(null)
});
export const newsFeedSchema = z.object({ portfolioId: z.string().nullable(), articles: z.array(newsFeedItemSchema), generatedAt: z.iso.datetime(), nextCursor: z.string().nullable().default(null) });
export type NewsFeed = z.infer<typeof newsFeedSchema>;
export const eventCursorSchema = z.string().regex(/^v1\.[0-9a-f-]{36}\.\d+-\d+$/);
export const eventRecoverySchema = z.object({
  cursor: z.string().max(2048).nullable().optional(),
  streams: z.object({ user: eventCursorSchema.nullable(), market: eventCursorSchema.nullable() }),
  retention: z.object({ replayWindowMs: z.number().int().positive(), userStreamMaxEntries: z.number().int().positive(), marketStreamMaxEntries: z.number().int().positive() }),
  portfolios: z.array(portfolioRecordSchema), watchlist: z.array(watchlistEntrySchema), news: newsFeedSchema, snapshotAt: z.iso.datetime()
});
export type EventRecovery = z.infer<typeof eventRecoverySchema>;
const resourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const quoteRequestSchema = z.array(resourceIdSchema).min(1).max(50);
export const newsFeedQuerySchema = z.object({ portfolioId: resourceIdSchema.nullable().default(null), limit: z.coerce.number().int().min(1).max(50).default(20), scope: z.enum(['all', 'watchlist']).default('all'), cursor: z.string().min(1).max(512).nullable().default(null) }).strict();
export const newsDetailSchema = z.object({ article: newsFeedItemSchema, provenance: z.array(z.object({ id: z.string(), source: z.string(), recordId: z.string(), providerAt: z.iso.datetime(), observedAt: z.iso.datetime(), revision: z.number().int().positive(), title: z.string(), url: z.string(), accepted: z.boolean().default(false) })),
  impacts: z.array(z.object({ portfolioId: z.string(), name: z.string(), asOf: z.iso.datetime(), positions: z.array(summaryPositionSchema) })), watchlisted: z.array(z.string()) });
export const newsReadResultSchema = z.object({ readAt: z.iso.datetime(), readRevisionAt: z.iso.datetime() });
export type NewsFeedItem = z.infer<typeof newsFeedItemSchema>;
export const newsPageCursorSchema = z.object({ at: z.iso.datetime(), id: z.string().min(1).max(64) }).strict();
export type NewsPageCursor = z.infer<typeof newsPageCursorSchema>;
export const newsObservationMetadataSchema = z.object({ publisher: z.string().optional(), sourceId: z.string(), revision: z.number().int().positive(), title: z.string(), canonicalUrl: z.string(), isDelayed: z.boolean(), delayMs: z.number().int().nonnegative() });
// Owner-scoped news search (milestone 17 agent tools). Text matches title/summary case-insensitively.
export const newsSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(100).nullable().default(null),
  symbols: z.array(z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,31}$/)).max(10).default([]),
  portfolioId: resourceIdSchema.nullable().default(null), scope: z.enum(['all', 'watchlist']).default('all'),
  limit: z.number().int().min(1).max(20).default(10), cursor: z.string().min(1).max(512).nullable().default(null)
}).strict();
export type NewsSearchQuery = z.input<typeof newsSearchQuerySchema>;
export type NewsDetail = z.infer<typeof newsDetailSchema>;
export type CachedQuote = z.infer<typeof cachedQuoteSchema>;
export type QuoteList = z.infer<typeof quoteListSchema>;

export * from './alerts.js';

export * from './approvals.js';
