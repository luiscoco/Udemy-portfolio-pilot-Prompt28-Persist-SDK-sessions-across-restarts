import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { authenticateOwner, closeConnections, createCache, getDatabase, ingestionRepository, newsReads } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { fixtureArticle, injectFixture } from '../src/fixture.js';

const url = process.env.NEWS_TEST_DATABASE_URL;
if (url && (!new URL(url).pathname.endsWith('_verify') || new URL(url).hostname !== '127.0.0.1')) throw new Error('Use a disposable loopback *_verify database');
afterAll(closeConnections);
describe.skipIf(!url)('persisted news pagination, read state and freshness', () => {
  it('keeps pages stable on insertion, isolates read state, rejects foreign access and retains accepted correction provenance', async () => {
    const db = await getDatabase(url!); await seedDemo(db);
    const run = `news-${randomUUID()}`; const repository = ingestionRepository(db);
    const tokens = [randomUUID(), randomUUID()];
    await db.session.createMany({ data: tokens.map((token, i) => ({ token, userId: i ? 'demo-bob' : 'demo-alice', expiresAt: new Date(Date.now() + 3600000) })) });
    const cache = createCache({ redis: async () => null });
    const alice = newsReads(db, cache, await authenticateOwner(db, tokens[0]!));
    const bob = newsReads(db, cache, await authenticateOwner(db, tokens[1]!));
    const env = { NODE_ENV: 'development', DATA_MODE: 'mock', DATABASE_URL: url! };
    const keys: string[] = [];
    async function commit(article: ReturnType<typeof fixtureArticle>) {
      const key = `${run}-${keys.length}`; keys.push(key);
      await repository.initialize(key); const lease = (await repository.acquire(key, run))!;
      await repository.commit(lease, { articles: [article], fetchedAt: article.ingestedAt, checkpoint: '', nextCursor: null }, { quotes: [], missing: [], fetchedAt: article.ingestedAt, checkpoint: '' }, 1000);
    }
    try {
      const original = fixtureArticle(run, 1, '2090-01-01T12:00:00.000Z');
      await injectFixture(repository, { id: run, revision: 1, publishedAt: original.publishedAt }, env);
      const first = await alice.feed({ scope: 'watchlist', limit: 1 });
      expect(first.articles).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
      const articleId = first.articles[0]!.id;
      expect(first.articles[0]!.title).toBe(original.title);
      await commit({ ...original, sourceRecordId: `${run}-newer`, canonicalUrl: `${original.canonicalUrl}/newer`, publishedAt: '2091-01-01T12:00:00.000Z' });
      const second = await alice.feed({ scope: 'watchlist', limit: 1, cursor: first.nextCursor });
      expect(second.articles[0]!.id).not.toBe(articleId);
      expect(second.articles[0]!.title).not.toBe(original.title);
      expect((await alice.feed({ portfolioId: 'demo-income' })).articles.some(a => a.id === articleId)).toBe(true);
      expect((await alice.feed({ portfolioId: 'demo-growth' })).articles.some(a => a.id === articleId)).toBe(false);
      expect((await bob.feed()).articles.some(a => a.id === articleId)).toBe(false);
      await expect(bob.detail(articleId)).rejects.toThrow('Resource not found');
      await expect(bob.markRead(articleId)).rejects.toThrow('Resource not found');
      await expect(bob.feed({ portfolioId: 'demo-income' })).rejects.toThrow('Resource not found');
      await expect(alice.feed({ cursor: 'bad' })).rejects.toThrow('Invalid news cursor');
      const read = await alice.markRead(articleId);
      expect(await alice.markRead(articleId)).toEqual(read);
      expect((await alice.detail(articleId)).article.readRevisionAt).toBe(read.readRevisionAt);
      await commit(fixtureArticle(run, 2, original.publishedAt));
      const corrected = await alice.detail(articleId);
      expect(corrected.article.revision).toBe(2); expect(corrected.provenance).toHaveLength(2);
      expect(corrected.article.updatedAt).not.toBe(read.readRevisionAt);
      // An older revision at the SAME provider timestamp is preserved as evidence, never displayed.
      await commit({ ...original, title: 'Stale equal-timestamp revision', providerAt: corrected.article.providerAt! });
      const latest = await alice.detail(articleId);
      expect(latest.article.title).toBe(corrected.article.title); expect(latest.article.revision).toBe(2);
      expect(latest.article.ingestedAt).toBe(corrected.article.ingestedAt);
      expect(latest.provenance).toHaveLength(3);
      await commit(fixtureArticle(run, 2, original.publishedAt));
      expect((await alice.detail(articleId)).provenance).toHaveLength(3);
      expect(await db.outboxEvent.count({ where: { type: 'news.article.ingested', entityId: articleId } })).toBe(2);
      expect((await alice.detail(articleId)).impacts[0]!.positions[0]!.remainingQuantity).toBe('4.0000000000');
    } finally {
      const articles = await db.newsArticle.findMany({ where: { provider: 'development-fixture', providerArticleId: { startsWith: run } }, select: { id: true } });
      await db.outboxEvent.deleteMany({ where: { entityId: { in: articles.map(a => a.id) } } });
      await db.newsArticle.deleteMany({ where: { id: { in: articles.map(a => a.id) } } });
      await db.ingestionState.deleteMany({ where: { key: { in: keys } } });
      await db.session.deleteMany({ where: { token: { in: tokens } } });
    }
  });
});
