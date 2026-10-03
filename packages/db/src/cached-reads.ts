import { cachedQuoteSchema, quoteListSchema, quoteRequestSchema } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { CACHE_POLICIES, type Cache } from './cache.js';

const nullableQuote = cachedQuoteSchema.nullable();

/** Global market data: one key per security, shared by every user (it contains no user data). */
export function quoteReads(db: PrismaClient, cache: Cache) {
  return {
    latest: async (input: unknown) => {
      const ids = [...new Set(quoteRequestSchema.parse(input))];
      const quotes = await Promise.all(ids.map(securityId => cache.getOrLoad(cache.keys.quoteLatest(securityId), CACHE_POLICIES.quoteLatest, nullableQuote, async () => {
        const row = await db.quoteSnapshot.findFirst({ where: { securityId, asOf: { lte: new Date() } }, orderBy: [{ asOf: 'desc' }, { id: 'asc' }] });
        return row ? { securityId, price: row.price.toFixed(), currency: row.currency, asOf: row.asOf.toISOString(), provider: row.provider, isSynthetic: row.isSynthetic } : null;
      })));
      return quoteListSchema.parse({ quotes: quotes.filter(q => q !== null), missing: ids.filter((_, i) => quotes[i] === null), servedAt: new Date().toISOString() });
    }
  };
}

export { newsReads } from './news-service.js';
