import { describe, expect, it } from 'vitest';
import type { NewsProvider, QuoteProvider, Security } from '../src/index.js';

// Later adapters supply a recorded transport/clock with at least two news records.
// No network, credentials, vendor payload shape, or mock class is assumed.
export function providerContract(name: string, setup: () => { quotes: QuoteProvider; news: NewsProvider; known: Security; unknown: Security }) {
  describe(`${name} provider contract`, () => {
    it('returns decimal prices, explicit missing identities, and trustworthy provenance', async () => {
      const { quotes, known, unknown } = setup(); const batch = await quotes.getQuotes([known, unknown]);
      expect(batch.checkpoint).toBeTruthy(); expect(Number.isFinite(Date.parse(batch.fetchedAt))).toBe(true);
      expect(batch.missing).toContainEqual(unknown); expect(batch.quotes).toHaveLength(1);
      for (const quote of batch.quotes) {
        expect(quote.security).toEqual(known); expect(quote.price).toMatch(/^\d+(\.\d+)?$/); expect(quote.currency).toMatch(/^[A-Z]{3}$/);
        expect(quote.sourceId).toBe(quotes.sourceId); expect(quote.sourceRecordId).toBeTruthy();
        expect(Date.parse(quote.providerAt)).toBeLessThanOrEqual(Date.parse(quote.ingestedAt));
        expect(Date.parse(quote.ingestedAt)).toBeLessThanOrEqual(Date.parse(batch.fetchedAt));
        expect(quote.isDelayed).toBe(quotes.capabilities.timeliness === 'delayed');
        expect(quote.delayMs).toBe(quotes.capabilities.delayMs); expect(quote.isSynthetic).toBe(quotes.mode === 'mock');
      }
    });
    it('pages without dropping records and resumes after the delivered checkpoint', async () => {
      const { news } = setup(); const first = await news.getNews({ limit: 1 });
      expect(first.articles.length).toBeGreaterThan(0);
      if (!news.capabilities.pagination) { expect(first.nextCursor).toBeNull(); return; }
      expect(first.articles).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
      const second = await news.getNews({ cursor: first.nextCursor!, limit: 1 });
      if (news.capabilities.checkpoints) {
        const resumed = await news.getNews({ checkpoint: first.checkpoint, limit: 1 });
        expect(resumed).toEqual(second);
      }
      expect(second.articles[0]?.sourceRecordId).not.toBe(first.articles[0]?.sourceRecordId);
      for (const article of [...first.articles, ...second.articles]) {
        expect(new URL(article.canonicalUrl).protocol).toMatch(/^https?:$/); expect(article.sourceId).toBe(news.sourceId);
        expect(article.revision).toBeGreaterThan(0); expect(Number.isFinite(Date.parse(article.publishedAt))).toBe(true);
        expect(Date.parse(article.providerAt)).toBeLessThanOrEqual(Date.parse(article.ingestedAt));
        expect(article.isSynthetic).toBe(news.mode === 'mock'); expect(article.isDelayed).toBe(news.capabilities.timeliness === 'delayed');
      }
    });
    it('rejects foreign checkpoint rather than silently skipping data', async () => {
      const { news } = setup(); await expect(news.getNews({ checkpoint: 'foreign-checkpoint' })).rejects.toThrow();
    });
  });
}
