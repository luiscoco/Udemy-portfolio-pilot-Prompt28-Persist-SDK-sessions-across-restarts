import type { NewsSearchQuery } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import type { Cache } from './cache.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError, portfolioService } from './portfolio-service.js';
import { summaryService } from './summary-service.js';
import { newsReads } from './news-service.js';
import { quoteReads } from './cached-reads.js';

const bounded = (take: number, max: number) => {
  if (!Number.isInteger(take) || take < 1 || take > max) throw new PortfolioError(400, 'Invalid limit.');
  return take;
};

/**
 * Read-only repository port for agent tools. The owner is bound here from the authenticated session;
 * no method accepts a user ID, and every query is owner-scoped in SQL (foreign rows are "not found").
 */
export function agentToolReads(db: PrismaClient, cache: Cache, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  const portfolios = portfolioService(db, owner);
  const summaries = summaryService(db, owner);
  const news = newsReads(db, cache, owner);
  const quotes = quoteReads(db, cache);
  return {
    async listPortfolios(take: number) {
      const rows = await db.portfolio.findMany({ where: { ownerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: bounded(take, 101), select: { id: true, name: true, archivedAt: true } });
      return rows.map(row => ({ id: row.id, name: row.name, archivedAt: row.archivedAt?.toISOString() ?? null }));
    },
    getSummary: (portfolioId: string, now: Date) => summaries.get(portfolioId, now),
    listTransactions: (portfolioId: string, page: { limit: number; offset: number }) => portfolios.transactions(portfolioId, { limit: bounded(page.limit, 100), offset: page.offset }),
    /** Securities in the owner's interest: ever traded in an owned portfolio, or on the owner's watchlist. */
    async listSecurities(securityIds: readonly string[] | null, take: number) {
      const rows = await db.security.findMany({
        where: { AND: [{ OR: [{ watchlist: { some: { ownerId } } }, { transactions: { some: { portfolio: { ownerId } } } }] }, ...(securityIds ? [{ id: { in: [...securityIds] } }] : [])] },
        include: { watchlist: { where: { ownerId }, select: { id: true } }, transactions: { where: { portfolio: { ownerId } }, select: { id: true }, take: 1 } },
        orderBy: [{ symbol: 'asc' }, { exchangeMic: 'asc' }, { id: 'asc' }], take: bounded(take, 101)
      });
      return rows.map(row => ({ id: row.id, symbol: row.symbol, exchangeMic: row.exchangeMic, name: row.name, currency: row.currency, watchlisted: row.watchlist.length > 0, traded: row.transactions.length > 0 }));
    },
    latestQuotes: (securityIds: readonly string[]) => quotes.latest([...securityIds]),
    searchNews: (input: NewsSearchQuery) => news.search(input),
    getNewsArticle: (articleId: string) => news.detail(articleId)
  };
}
export type AgentToolReads = ReturnType<typeof agentToolReads>;
