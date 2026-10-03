import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getDatabase, closeConnections, ingestionRepository } from '@portfolio-pilot/db';
import { ManualClock, MockProviders } from '@portfolio-pilot/providers';
import { ingestOnce } from '../src/ingestion.js';

const databaseUrl = process.env.INGESTION_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_verify')) throw new Error('Use a disposable loopback *_verify database');
}
afterAll(closeConnections);
describe.skipIf(!databaseUrl)('PostgreSQL ingestion acceptance', () => {
  it('ingests mocks, deduplicates, restarts checkpoints, preserves history and fences replicas', async () => {
    const db = await getDatabase(databaseUrl!); const repository = ingestionRepository(db);
    const key = `verify-${randomUUID()}`; const epoch = '2026-10-02T12:00:00.000Z';
    const clock = new ManualClock(epoch); clock.advance(3000);
    const mock = new MockProviders({ clock, startAt: epoch, intervalMs: 1000, scenario: 'corrections' });
    // Unique catalog name for acceptance without altering existing seed securities.
    const security = await db.security.create({ data: { symbol: 'VERIFY12', exchangeMic: 'XNAS', name: key } });
    const original = mock.getNews.bind(mock);
    mock.getNews = async request => { const page = await original({ ...request, limit: 1 }); return { ...page, articles: page.articles.map(a => ({ ...a, sourceId: key, canonicalUrl: a.canonicalUrl.replace('/mock/', `/${key}/`), symbols: ['VERIFY12'] })) }; };
    const quotes = mock.getQuotes.bind(mock);
    mock.getQuotes = async () => { const batch = await quotes([{ symbol: 'ACME', exchangeMic: 'XNAS' }]); return { ...batch, quotes: batch.quotes.map(q => ({ ...q, sourceId: key, security: { symbol: 'VERIFY12', exchangeMic: 'XNAS' } })) }; };
    await repository.initialize(key, new Date(epoch));
    const forceDue = () => db.ingestionState.update({ where: { key }, data: { nextRunAt: new Date(0) } });
    try {
      const contenders = await Promise.all([repository.acquire(key, 'one'), repository.acquire(key, 'two')]);
      expect(contenders.filter(Boolean)).toHaveLength(1); const lease = contenders.find(Boolean)!;
      expect(await ingestOnce(repository, lease, { news: mock, quotes: mock }, 1000)).toBe('committed');
      const saved = await db.ingestionState.findUniqueOrThrow({ where: { key } });
      expect(saved.cursor).toBeTruthy(); expect(saved.checkpoint).toBeTruthy();
      await forceDue();
      const restarted = ingestionRepository(db); const resumed = (await restarted.acquire(key, 'restart'))!;
      expect(resumed.cursor).toBe(saved.cursor);
      expect(await ingestOnce(restarted, resumed, { news: mock, quotes: mock }, 1000)).toBe('committed');
      expect(await db.newsArticle.count({ where: { provider: key } })).toBe(1);
      expect(await db.newsObservation.count({ where: { provider: key } })).toBe(2);
      expect((await db.newsArticle.findFirstOrThrow({ where: { provider: key } })).title).toContain('Correction');
      expect(await db.newsArticleSecurity.count({ where: { securityId: security.id } })).toBe(1);
      expect(await db.quoteSnapshot.count({ where: { securityId: security.id } })).toBe(1);
      // The same page transactions wrote global events: one market quote batch and an internal article event.
      const article = await db.newsArticle.findFirstOrThrow({ where: { provider: key } });
      expect(await db.outboxEvent.count({ where: { type: 'quote.updated', audience: 'market', entityId: key, ownerId: null } })).toBe(1);
      const ingested = await db.outboxEvent.findMany({ where: { type: 'news.article.ingested', entityId: article.id } });
      expect(ingested.length).toBeGreaterThanOrEqual(1);
      expect(ingested.every(e => e.audience === 'system' && e.ownerId === null && (e.payload as { securityIds: string[] }).securityIds.includes(security.id))).toBe(true);
      // Replay a page, and deliver a second provider ID for the same canonical URL.
      await forceDue(); const replay = (await repository.acquire(key, 'replay'))!;
      const page = await mock.getNews({});
      await repository.commit(replay, { ...page, articles: [...page.articles, { ...page.articles[0]!, sourceRecordId: 'alias', canonicalUrl: `${page.articles[0]!.canonicalUrl}?utm_source=x#fragment` }] }, await mock.getQuotes([]), 1000);
      expect(await db.newsArticle.count({ where: { provider: key } })).toBe(1);
      expect(await db.newsObservation.count({ where: { provider: key } })).toBe(3);
      expect(await db.newsSource.count({ where: { provider: key } })).toBe(2);
      expect((await db.newsArticle.findFirstOrThrow({ where: { provider: key } })).title).toContain('Correction');
      // An identical replay changes nothing and therefore emits no events (duplicate suppression at the source).
      const events = () => db.outboxEvent.count({ where: { OR: [{ entityId: key }, { payload: { path: ['securityIds'], array_contains: [security.id] } }] } });
      const eventCount = await events();
      await forceDue(); await repository.commit((await repository.acquire(key, 'duplicate'))!, page, await mock.getQuotes([]), 1000);
      expect(await events()).toBe(eventCount);
      await forceDue(); const failedLease = (await repository.acquire(key, 'failure'))!;
      mock.scenario = 'outage';
      expect(await ingestOnce(repository, failedLease, { news: mock, quotes: mock }, 1000)).toBe('retry');
      const failed = await db.ingestionState.findUniqueOrThrow({ where: { key } });
      expect(failed.checkpoint).toBe(failedLease.checkpoint); expect(failed.failures).toBe(1); expect(failed.leaseOwner).toBeNull();
      expect(await repository.acquire(key, 'too-early')).toBeNull();
      mock.scenario = 'corrections'; await forceDue();
      const recovery = (await repository.acquire(key, 'recovery'))!;
      expect(await ingestOnce(repository, recovery, { news: mock, quotes: mock }, 1000)).toBe('committed');
      expect((await db.ingestionState.findUniqueOrThrow({ where: { key } })).failures).toBe(0);
      await forceDue();
      const old = (await repository.acquire(key, 'old'))!;
      await db.ingestionState.update({ where: { key }, data: { leaseUntil: new Date(0) } });
      const replacement = (await repository.acquire(key, 'replacement'))!;
      await expect(repository.commit(old, page, await mock.getQuotes([]), 1000)).rejects.toThrow('LEASE_LOST');
      await repository.fail(old, 1000);
      expect((await db.ingestionState.findUniqueOrThrow({ where: { key } })).leaseOwner).toBe('replacement');
      await repository.commit(replacement, page, await mock.getQuotes([]), 1000);
      // Invalid record rolls back the whole page and its checkpoint.
      await forceDue(); const invalid = (await repository.acquire(key, 'invalid'))!;
      await expect(repository.commit(invalid, { ...page, articles: [{ ...page.articles[0]!, canonicalUrl: 'javascript:bad' }] }, await mock.getQuotes([]), 1000)).rejects.toThrow();
      expect((await db.ingestionState.findUniqueOrThrow({ where: { key } })).checkpoint).toBe(invalid.checkpoint);
      await repository.fail(invalid, 1); await forceDue();
      // Two existing articles become one when a later source-ID correction bridges URLs.
      const other = { ...page.articles[0]!, sourceRecordId: 'other', canonicalUrl: `${page.articles[0]!.canonicalUrl}/other`, title: 'Other headline', providerAt: '2026-10-02T12:00:02.000Z' };
      await repository.commit((await repository.acquire(key, 'other'))!, { ...page, articles: [other] }, await mock.getQuotes([]), 1000);
      expect(await db.newsArticle.count({ where: { provider: key } })).toBe(2);
      await forceDue();
      await repository.commit((await repository.acquire(key, 'bridge'))!, { ...page, articles: [{ ...other, sourceRecordId: 'news-0', title: 'Bridge correction', providerAt: '2026-10-02T12:00:03.000Z', symbols: [] }] }, await mock.getQuotes([]), 1000);
      expect(await db.newsArticle.count({ where: { provider: key } })).toBe(1);
      expect(await db.newsSource.count({ where: { provider: key } })).toBe(3);
      expect(await db.newsArticleSecurity.count({ where: { securityId: security.id } })).toBe(0);
      expect((await db.newsArticle.findFirstOrThrow({ where: { provider: key } })).title).toBe('Bridge correction');
    } finally {
      await db.outboxEvent.deleteMany({ where: { OR: [{ entityId: key }, { payload: { path: ['securityIds'], array_contains: [security.id] } }] } });
      await db.newsArticle.deleteMany({ where: { provider: key } });
      await db.ingestionState.delete({ where: { key } });
      await db.security.delete({ where: { id: security.id } });
    }
  });
});
