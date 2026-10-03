import { createHash, randomUUID } from 'node:crypto';
import type { Article, NewsPage, QuoteBatch } from '@portfolio-pilot/providers';
import type { PrismaClient } from './generated/prisma/client.js';
import { appendEvent } from './outbox.js';
import { invalidateArticleResearch } from './research-service.js';

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_ARTICLE_URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export interface Lease { key: string; owner: string; generation: number; checkpoint: string | null; cursor: string | null; mockStartAt: Date; failures: number }
export function ingestionRepository(db: PrismaClient) {
  return {
    async initialize(key: string, start?: Date) {
      // Immediately due even when client/database clocks differ by a few milliseconds.
      return db.ingestionState.upsert({ where: { key }, update: {}, create: { key, nextRunAt: new Date(0), ...(start ? { mockStartAt: start } : {}) } });
    },
    async acquire(key: string, owner: string, leaseMs = 120000): Promise<Lease | null> {
      const rows = await db.$queryRaw<Lease[]>`UPDATE "IngestionState" SET "leaseOwner"=${owner}, "leaseUntil"=clock_timestamp()+${leaseMs} * interval '1 millisecond', "generation"="generation"+1
        WHERE "key"=${key} AND "nextRunAt"<=clock_timestamp() AND ("leaseUntil" IS NULL OR "leaseUntil"<=clock_timestamp())
        RETURNING "key", "leaseOwner" AS owner, "generation", "checkpoint", "cursor", "mockStartAt", "failures"`;
      return rows[0] ?? null;
    },
    async fail(lease: Lease, delayMs: number) {
      await db.$executeRaw`UPDATE "IngestionState" SET "failures"="failures"+1, "nextRunAt"=clock_timestamp()+${delayMs} * interval '1 millisecond', "leaseOwner"=NULL, "leaseUntil"=NULL
        WHERE "key"=${lease.key} AND "leaseOwner"=${lease.owner} AND "generation"=${lease.generation} AND "leaseUntil">clock_timestamp()`;
    },
    async commit(lease: Lease, page: NewsPage, batch: QuoteBatch, intervalMs: number) {
      await db.$transaction(async tx => {
        const held = await tx.$queryRaw<{ key: string }[]>`SELECT "key" FROM "IngestionState" WHERE "key"=${lease.key} AND "leaseOwner"=${lease.owner} AND "generation"=${lease.generation} AND "leaseUntil">clock_timestamp() FOR UPDATE`;
        if (!held.length) throw new Error('LEASE_LOST');
        // Serialize canonical URL merges across provider schedules, not just replicas of one job.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1212)`;
        // Accepted changes in this page; replays and older deliveries add nothing, so emit no events.
        const changed = new Map<string, { change: 'new' | 'correction'; securityIds: string[] }>();
        const quotes: { securityId: string; asOf: string }[] = [];
        for (const input of page.articles) {
          const article: Article = { ...input, canonicalUrl: canonicalUrl(input.canonicalUrl), symbols: [...new Set(input.symbols.map(s => s.trim().toUpperCase()))].sort(), publishedAt: new Date(input.publishedAt).toISOString(), providerAt: new Date(input.providerAt).toISOString() };
          if (!article.sourceId || !article.sourceRecordId || !article.title || article.revision < 1) throw new Error('INVALID_ARTICLE');
          const { ingestedAt: _ingestedAt, ...metadata } = article;
          const fingerprint = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
          const source = await tx.newsSource.findUnique({ where: { provider_recordId: { provider: article.sourceId, recordId: article.sourceRecordId } } });
          const urlAlias = await tx.newsUrl.findUnique({ where: { url: article.canonicalUrl } });
          let current = source || urlAlias ? await tx.newsArticle.findUniqueOrThrow({ where: { id: (source ?? urlAlias)!.articleId } }) : await tx.newsArticle.findFirst({ where: { OR: [{ canonicalKey: article.canonicalUrl }, { provider: article.sourceId, providerArticleId: article.sourceRecordId }, { url: article.canonicalUrl }] } });
          const data = { provider: article.sourceId, providerArticleId: article.sourceRecordId, title: article.title, summary: article.summary, url: article.canonicalUrl, publishedAt: new Date(article.publishedAt), isSynthetic: article.isSynthetic };
          const isNew = !current;
          if (!current) current = await tx.newsArticle.create({ data: { ...data, canonicalKey: article.canonicalUrl } });
          const merged = source && urlAlias && source.articleId !== urlAlias.articleId;
          if (merged) {
            // A correction can bridge previously independent IDs/URLs. Keep every alias/history.
            await tx.newsObservation.updateMany({ where: { articleId: urlAlias.articleId }, data: { articleId: current.id } });
            await tx.newsSource.updateMany({ where: { articleId: urlAlias.articleId }, data: { articleId: current.id } });
            await tx.newsUrl.updateMany({ where: { articleId: urlAlias.articleId }, data: { articleId: current.id } });
            const reads = await tx.newsRead.findMany({ where: { articleId: urlAlias.articleId } });
            if (reads.length) await tx.newsRead.createMany({ data: reads.map(read => ({ ...read, articleId: current!.id })), skipDuplicates: true });
            await tx.newsArticle.delete({ where: { id: urlAlias.articleId } });
            changed.delete(urlAlias.articleId);
            // Recommendations citing the merged-away article become visibly stale ("article_withdrawn").
            await invalidateArticleResearch(tx, urlAlias.articleId);
          }
          await tx.newsUrl.upsert({ where: { url: article.canonicalUrl }, update: {}, create: { url: article.canonicalUrl, articleId: current.id } });
          await tx.newsSource.upsert({ where: { provider_recordId: { provider: article.sourceId, recordId: article.sourceRecordId } }, update: {}, create: { provider: article.sourceId, recordId: article.sourceRecordId, articleId: current.id } });
          const previous = current.acceptedObservationId && !merged ? await tx.newsObservation.findUnique({ where: { id: current.acceptedObservationId } }) : await tx.newsObservation.findFirst({ where: { articleId: current.id }, orderBy: [{ providerAt: 'desc' }, { observedAt: 'desc' }, { id: 'asc' }] });
          const observation = await tx.newsObservation.createMany({ data: [{ id: randomUUID(), articleId: current.id, provider: article.sourceId, recordId: article.sourceRecordId, fingerprint, providerAt: new Date(article.providerAt), metadata }], skipDuplicates: true });
          const previousMetadata = previous?.metadata as unknown as Article | undefined;
          const fresher = !previous || previous.providerAt.getTime() < Date.parse(article.providerAt) ||
            (previous.providerAt.getTime() === Date.parse(article.providerAt) && (previous.provider !== article.sourceId || article.revision >= (previousMetadata?.revision ?? 1)));
          if (merged || (observation.count && fresher)) {
            const effective = merged && previous && !fresher ? previous.metadata as unknown as Article : article;
            const accepted = effective === article ? await tx.newsObservation.findUniqueOrThrow({ where: { provider_recordId_fingerprint: { provider: article.sourceId, recordId: article.sourceRecordId, fingerprint } } }) : previous!;
            // Provider ID stays the primary source; aliases and immutable observations retain all sources.
            await tx.newsArticle.update({ where: { id: current.id }, data: { title: effective.title, summary: effective.summary, publishedAt: new Date(effective.publishedAt), url: effective.canonicalUrl, isSynthetic: effective.isSynthetic, acceptedObservationId: accepted.id } });
            const priorLinks = await tx.newsArticleSecurity.findMany({ where: { newsArticleId: current.id } });
            await tx.newsArticleSecurity.deleteMany({ where: { newsArticleId: current.id } });
            // A ticker alone is insufficient when more than one catalog security has that ticker.
            const securityIds: string[] = [];
            for (const symbol of effective.symbols) {
              const securities = await tx.security.findMany({ where: { symbol, currency: 'USD', assetType: 'STOCK' } });
              if (securities.length === 1) { await tx.newsArticleSecurity.create({ data: { newsArticleId: current.id, securityId: securities[0]!.id } }); securityIds.push(securities[0]!.id); }
            }
            changed.set(current.id, { change: isNew || changed.get(current.id)?.change === 'new' ? 'new' : 'correction', securityIds: [...new Set([...securityIds, ...priorLinks.map(s => s.securityId)])].sort() });
            // Same transaction as the accepted correction: supersede other-revision analyses and mark citing recommendations stale.
            if (!isNew) await invalidateArticleResearch(tx, current.id);
          }
        }
        for (const quote of batch.quotes) {
          if (quote.currency !== 'USD' || !/^\d+(\.\d+)?$/.test(quote.price) || !/[1-9]/.test(quote.price)) throw new Error('INVALID_QUOTE');
          const security = await tx.security.findUnique({ where: { exchangeMic_symbol: { exchangeMic: quote.security.exchangeMic.trim().toUpperCase(), symbol: quote.security.symbol.trim().toUpperCase() } } });
          if (!security) continue;
          const inserted = await tx.quoteSnapshot.createMany({ data: [{ securityId: security.id, provider: quote.sourceId, asOf: new Date(quote.providerAt), price: quote.price, currency: quote.currency, isSynthetic: quote.isSynthetic }], skipDuplicates: true });
          if (inserted.count) quotes.push({ securityId: security.id, asOf: new Date(quote.providerAt).toISOString() });
        }
        // Article ingestion stays global: one internal event per changed article. The dispatcher fans it
        // out to owner-scoped notifications; no user data is computed or published here.
        for (const [articleId, change] of changed) if (change.securityIds.length) {
          await appendEvent(tx, { type: 'news.article.ingested', audience: { kind: 'system' }, entityType: 'news_article', entityId: articleId, portfolioId: null, payload: change });
        }
        if (quotes.length) await appendEvent(tx, { type: 'quote.updated', audience: { kind: 'market' }, entityType: 'quote_batch', entityId: lease.key, portfolioId: null, payload: { quotes } });
        await tx.$executeRaw`UPDATE "IngestionState" SET "checkpoint"=${page.checkpoint}, "cursor"=${page.nextCursor}, "failures"=0,
          "nextRunAt"=clock_timestamp()+${page.nextCursor ? 1000 : intervalMs} * interval '1 millisecond', "leaseOwner"=NULL, "leaseUntil"=NULL WHERE "key"=${lease.key}`;
      }, { timeout: 30000 });
    },
    async securities() { return db.security.findMany({ where: { currency: 'USD', assetType: 'STOCK' }, select: { symbol: true, exchangeMic: true } }); }
  };
}
