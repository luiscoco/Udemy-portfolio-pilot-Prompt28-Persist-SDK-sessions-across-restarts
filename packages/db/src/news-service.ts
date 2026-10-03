import { newsPageCursorSchema as cursorSchema, newsObservationMetadataSchema as metadataSchema, newsFeedQuerySchema, newsSearchQuerySchema, newsFeedSchema, newsDetailSchema, type NewsFeed, type NewsPageCursor } from '@portfolio-pilot/contracts';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { CACHE_POLICIES, type Cache } from './cache.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';
import { summaryService } from './summary-service.js';

const include = { securities: { include: { security: { select: { id: true, symbol: true, exchangeMic: true } } } } } satisfies Prisma.NewsArticleInclude;
type Row = Prisma.NewsArticleGetPayload<{ include: typeof include }>;
function dto(row: Row, latest: { metadata: unknown; observedAt: Date; providerAt: Date } | null) {
  const metadata = metadataSchema.safeParse(latest?.metadata);
  return { id: row.id, provider: row.provider, source: metadata.success ? metadata.data.publisher ?? metadata.data.sourceId : row.provider,
    title: row.title, summary: row.summary, url: row.url, isSynthetic: row.isSynthetic,
    publishedAt: row.publishedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), ingestedAt: (latest?.observedAt ?? row.createdAt).toISOString(),
    providerAt: latest?.providerAt.toISOString() ?? null, revision: metadata.success ? metadata.data.revision : 1,
    isDelayed: metadata.success ? metadata.data.isDelayed : null, delayMs: metadata.success ? metadata.data.delayMs : null,
    securities: row.securities.map(link => link.security).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exchangeMic.localeCompare(b.exchangeMic)) };
}
/** The owner's current-interest audience: open positions in active portfolios, plus the watchlist. */
export async function ownerInterest(client: Prisma.TransactionClient, ownerId: string, portfolioId: string | null = null, scope = 'all'): Promise<Prisma.SecurityWhereInput> {
  if (scope === 'watchlist') return { watchlist: { some: { ownerId } } };
  // Match outbox fan-out: historical, fully sold positions do not contribute to current news.
  const held = await client.$queryRaw<{ securityId: string }[]>`
    SELECT DISTINCT t."securityId" FROM "PortfolioTransaction" t JOIN "Portfolio" p ON p."id"=t."portfolioId"
    WHERE p."ownerId"=${ownerId} AND p."archivedAt" IS NULL AND (${portfolioId}::text IS NULL OR p."id"=${portfolioId})
    GROUP BY p."id", t."securityId" HAVING SUM(CASE WHEN t."side"='BUY' THEN t."quantity" ELSE -t."quantity" END)>0`;
  const holdings = { id: { in: held.map(h => h.securityId) } };
  return portfolioId ? holdings : { OR: [holdings, { watchlist: { some: { ownerId } } }] };
}
export function newsReads(db: PrismaClient, cache: Cache, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  const interest = (client: Prisma.TransactionClient = db, portfolioId: string | null = null, scope = 'all') => ownerInterest(client, ownerId, portfolioId, scope);
  async function articleDtos(rows: Row[]) {
    const accepted = await db.newsObservation.findMany({ where: { id: { in: rows.flatMap(row => row.acceptedObservationId ? [row.acceptedObservationId] : []) } } });
    return rows.map(row => dto(row, accepted.find(o => o.id === row.acceptedObservationId && o.articleId === row.id) ?? null));
  }
  async function article(id: string) {
    const row = await db.newsArticle.findFirst({ where: { id, securities: { some: { security: await interest() } } }, include });
    if (!row) throw new PortfolioError(404, 'Resource not found.');
    return row;
  }
  async function reads(feed: NewsFeed): Promise<NewsFeed> {
    const rows = await db.newsRead.findMany({ where: { ownerId, articleId: { in: feed.articles.map(a => a.id) } } });
    return { ...feed, articles: feed.articles.map(a => { const read = rows.find(r => r.articleId === a.id); return { ...a, readAt: read?.readAt.toISOString() ?? null, readRevisionAt: read?.readRevisionAt.toISOString() ?? null }; }) };
  }
  return {
    async feed(input: unknown = {}) {
      const { portfolioId, limit, scope, cursor } = newsFeedQuerySchema.parse(input);
      if (portfolioId && !await db.portfolio.findFirst({ where: { id: portfolioId, ownerId, archivedAt: null }, select: { id: true } })) throw new PortfolioError(404, 'Resource not found.');
      if (portfolioId && scope === 'watchlist') throw new PortfolioError(400, 'Choose a portfolio or watchlist filter.');
      let after: NewsPageCursor | null = null;
      if (cursor) { try { after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); } catch { throw new PortfolioError(400, 'Invalid news cursor.'); } }
      const load = async (): Promise<NewsFeed> => {
        const security = await interest(db, portfolioId, scope);
        const rows = await db.newsArticle.findMany({ where: { securities: { some: { security } }, ...(after ? { OR: [{ publishedAt: { lt: new Date(after.at) } }, { publishedAt: new Date(after.at), id: { gt: after.id } }] } : {}) }, include, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: limit + 1 });
        const visible = rows.slice(0, limit); const last = visible.at(-1);
        return newsFeedSchema.parse({ portfolioId, generatedAt: new Date().toISOString(), articles: await articleDtos(visible), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.publishedAt.toISOString(), id: last.id })).toString('base64url') : null });
      };
      // Cursor/watchlist shapes bypass the old cache key. Read state is always overlaid from PostgreSQL.
      const generation = cursor || scope === 'watchlist' ? null : await cache.generation(cache.keys.userGeneration(ownerId));
      const feed = generation === null ? await load() : await cache.getOrLoad(`${cache.keys.ownerNews(ownerId, generation, portfolioId, limit)}:m16`, CACHE_POLICIES.ownerNews, newsFeedSchema, load);
      return reads(feed);
    },
    /** Uncached owner-scoped search over the same current-interest audience as the feed. */
    async search(input: unknown = {}) {
      const { query, symbols, portfolioId, scope, limit, cursor } = newsSearchQuerySchema.parse(input);
      if (portfolioId && !await db.portfolio.findFirst({ where: { id: portfolioId, ownerId, archivedAt: null }, select: { id: true } })) throw new PortfolioError(404, 'Resource not found.');
      if (portfolioId && scope === 'watchlist') throw new PortfolioError(400, 'Choose a portfolio or watchlist filter.');
      let after: NewsPageCursor | null = null;
      if (cursor) { try { after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); } catch { throw new PortfolioError(400, 'Invalid news cursor.'); } }
      const security: Prisma.SecurityWhereInput = { AND: [await interest(db, portfolioId, scope), ...(symbols.length ? [{ symbol: { in: symbols } }] : [])] };
      const where: Prisma.NewsArticleWhereInput = { AND: [
        { securities: { some: { security } } },
        ...(query ? [{ OR: [{ title: { contains: query, mode: 'insensitive' as const } }, { summary: { contains: query, mode: 'insensitive' as const } }] }] : []),
        ...(after ? [{ OR: [{ publishedAt: { lt: new Date(after.at) } }, { publishedAt: new Date(after.at), id: { gt: after.id } }] }] : [])
      ] };
      const rows = await db.newsArticle.findMany({ where, include, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: limit + 1 });
      const visible = rows.slice(0, limit); const last = visible.at(-1);
      return reads(newsFeedSchema.parse({ portfolioId, generatedAt: new Date().toISOString(), articles: await articleDtos(visible), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.publishedAt.toISOString(), id: last.id })).toString('base64url') : null }));
    },
    async detail(id: string) {
      const row = await article(id);
      const securityIds = row.securities.map(s => s.securityId);
      const portfolios = await db.portfolio.findMany({ where: { ownerId, archivedAt: null, transactions: { some: { securityId: { in: securityIds } } } }, orderBy: { id: 'asc' } });
      const impacts = await Promise.all(portfolios.map(async p => { const summary = await summaryService(db, owner).get(p.id); return { portfolioId: p.id, name: p.name, asOf: summary.asOf, positions: summary.positions.filter(s => securityIds.includes(s.securityId) && /[1-9]/.test(s.remainingQuantity)) }; }));
      const history = await db.newsObservation.findMany({ where: { articleId: id }, orderBy: [{ providerAt: 'desc' }, { observedAt: 'desc' }, { id: 'asc' }], take: 100 });
      const feed = await reads(newsFeedSchema.parse({ portfolioId: null, generatedAt: new Date().toISOString(), articles: await articleDtos([row]) }));
      const watchlist = await db.watchlistEntry.findMany({ where: { ownerId, securityId: { in: securityIds } } });
      return newsDetailSchema.parse({ article: feed.articles[0], impacts: impacts.filter(p => p.positions.length), watchlisted: watchlist.map(w => w.securityId), provenance: history.map(o => { const m = metadataSchema.safeParse(o.metadata); return { id: o.id, accepted: o.id === row.acceptedObservationId, source: m.success ? m.data.publisher ?? o.provider : o.provider, recordId: o.recordId, providerAt: o.providerAt.toISOString(), observedAt: o.observedAt.toISOString(), revision: m.success ? m.data.revision : 1, title: m.success ? m.data.title : 'Unavailable', url: m.success ? m.data.canonicalUrl : row.url }; }) });
    },
    async markRead(id: string) {
      // Lock the article revision while recording it; a concurrent correction remains unread.
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "NewsArticle" WHERE "id"=${id} FOR SHARE`;
        const row = await tx.newsArticle.findFirst({ where: { id, securities: { some: { security: await interest(tx) } } } });
        if (!row) throw new PortfolioError(404, 'Resource not found.');
        const data = { ownerId, articleId: id, readRevisionAt: row.updatedAt };
        await tx.newsRead.createMany({ data: [data], skipDuplicates: true });
        await tx.newsRead.updateMany({ where: { ownerId, articleId: id, readRevisionAt: { lt: row.updatedAt } }, data: { readAt: new Date(), readRevisionAt: row.updatedAt } });
        const read = await tx.newsRead.findUniqueOrThrow({ where: { ownerId_articleId: { ownerId, articleId: id } } });
        return { readAt: read.readAt.toISOString(), readRevisionAt: read.readRevisionAt.toISOString() };
      });
    }
  };
}
