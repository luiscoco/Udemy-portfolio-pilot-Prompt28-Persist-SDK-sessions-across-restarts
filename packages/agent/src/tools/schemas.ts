import { z } from 'zod';

/** Hard bounds for every tool result. Lists page; text is clipped; serialized output is capped. */
export const TOOL_LIMITS = {
  portfolios: 20, holdings: 50, defaultHoldings: 25, transactions: 50, defaultTransactions: 20,
  quotes: 25, news: 10, defaultNews: 5, provenance: 10, impacts: 10, impactPositions: 20, articleSecurities: 20,
  titleChars: 300, summaryChars: 1000, articleSummaryChars: 4000, resultBytes: 48000
} as const;

const resourceId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'IDs are 1-64 letters, digits, "_" or "-".');
const symbol = z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,31}$/, 'Uppercase ticker such as "NOVA".');
const portfolioId = resourceId.describe('Portfolio ID exactly as returned by getPortfolioSummary.');

/**
 * Raw Zod shapes registered with the SDK `tool()` helper (it builds the JSON Schema the model sees).
 * There is deliberately no user/owner field anywhere: the account comes from the trusted context.
 */
export const toolInputShapes = {
  getPortfolioSummary: {
    portfolioId: portfolioId.optional().describe('Optional. Omit to list every portfolio this user owns (with IDs) and combined totals.')
  },
  listHoldings: {
    portfolioId,
    includeClosed: z.boolean().optional().describe('Include fully sold positions (default false).'),
    limit: z.number().int().min(1).max(TOOL_LIMITS.holdings).optional().describe(`Page size, 1-${TOOL_LIMITS.holdings} (default ${TOOL_LIMITS.defaultHoldings}).`),
    offset: z.number().int().min(0).max(10000).optional().describe('Zero-based offset from page.nextOffset (default 0).')
  },
  listTransactions: {
    portfolioId,
    limit: z.number().int().min(1).max(TOOL_LIMITS.transactions).optional().describe(`Page size, 1-${TOOL_LIMITS.transactions} (default ${TOOL_LIMITS.defaultTransactions}).`),
    offset: z.number().int().min(0).max(1000000).optional().describe('Zero-based offset from page.nextOffset (default 0).')
  },
  getQuotes: {
    securityIds: z.array(resourceId).min(1).max(TOOL_LIMITS.quotes).optional()
      .describe(`Optional security IDs (from holdings, transactions or news). Omit for the user's held and watchlisted securities (up to ${TOOL_LIMITS.quotes}).`)
  },
  searchNews: {
    query: z.string().trim().min(1).max(100).optional().describe('Optional case-insensitive text matched against headline and summary.'),
    symbols: z.array(symbol).min(1).max(10).optional().describe('Optional tickers to restrict results to.'),
    portfolioId: portfolioId.optional().describe('Optional. Only news about current holdings of this portfolio.'),
    scope: z.enum(['all', 'watchlist']).optional().describe('"all" (default): holdings and watchlist. "watchlist": watchlist only. Do not combine with portfolioId.'),
    limit: z.number().int().min(1).max(TOOL_LIMITS.news).optional().describe(`Page size, 1-${TOOL_LIMITS.news} (default ${TOOL_LIMITS.defaultNews}).`),
    cursor: z.string().min(1).max(512).optional().describe('Opaque page.nextCursor from a previous searchNews call.')
  },
  getNewsArticle: {
    articleId: resourceId.describe('Article ID from searchNews.')
  }
} as const;

export type PortfolioToolName = keyof typeof toolInputShapes;
export const PORTFOLIO_TOOL_NAMES = Object.keys(toolInputShapes) as PortfolioToolName[];

/**
 * Strict re-validation inside each handler. Through the SDK, the raw shape is validated first and
 * unknown keys (such as a model-supplied `userId`) are stripped before the handler runs. Direct
 * invocations (mock adapter, tests) are rejected here instead. Either way the owner comes only from
 * the trusted context.
 */
export const toolInputSchemas = {
  getPortfolioSummary: z.object(toolInputShapes.getPortfolioSummary).strict(),
  listHoldings: z.object(toolInputShapes.listHoldings).strict(),
  listTransactions: z.object(toolInputShapes.listTransactions).strict(),
  getQuotes: z.object(toolInputShapes.getQuotes).strict(),
  searchNews: z.object(toolInputShapes.searchNews).strict()
    .refine(value => !(value.portfolioId && value.scope === 'watchlist'), 'Choose either portfolioId or scope "watchlist", not both.'),
  getNewsArticle: z.object(toolInputShapes.getNewsArticle).strict()
} satisfies Record<PortfolioToolName, z.ZodType>;
export type PortfolioToolInput<N extends PortfolioToolName> = z.output<(typeof toolInputSchemas)[N]>;
