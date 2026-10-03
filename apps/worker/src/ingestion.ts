import { ProviderError, type NewsProvider, type QuoteProvider } from '@portfolio-pilot/providers';
import type { ingestionRepository, Lease } from '@portfolio-pilot/db';

type Repository = ReturnType<typeof ingestionRepository>;
export function retryDelay(failures: number, retryAt: string | null, now = Date.now(), random = Math.random): number {
  const jitter = Math.floor(Math.min(300000, 1000 * 2 ** Math.min(failures, 18)) * (0.5 + random() * 0.5));
  return Math.max(jitter, retryAt ? Math.max(0, Date.parse(retryAt) - now) || 0 : 0);
}
export async function ingestOnce(repository: Repository, lease: Lease, providers: { news: NewsProvider; quotes: QuoteProvider }, intervalMs: number, random = Math.random) {
  try {
    const page = await providers.news.getNews({ limit: 50, ...(lease.cursor ? { cursor: lease.cursor } : lease.checkpoint ? { checkpoint: lease.checkpoint } : {}) });
    const batch = await providers.quotes.getQuotes(await repository.securities());
    await repository.commit(lease, page, batch, intervalMs);
    return 'committed' as const;
  } catch (error) {
    await repository.fail(lease, retryDelay(lease.failures, error instanceof ProviderError ? error.retryAt : null, Date.now(), random));
    return 'retry' as const;
  }
}
