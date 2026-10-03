import { randomUUID } from 'node:crypto';
import { type ingestionRepository } from '@portfolio-pilot/db';
import type { Article, NewsProvider, QuoteProvider } from '@portfolio-pilot/providers';
import { ingestOnce } from './ingestion.js';

export function assertFixtureEnvironment(environment: NodeJS.ProcessEnv) {
  const url = new URL(environment.DATABASE_URL ?? '');
  if (environment.NODE_ENV !== 'development' || environment.DATA_MODE !== 'mock' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Fixture injection requires development, mock mode and loopback PostgreSQL.');
}
export function fixtureArticle(id: string, revision: number, publishedAt: string): Article {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ![1, 2].includes(revision)) throw new Error('Use a fixture ID and revision 1 or 2.');
  const published = new Date(publishedAt).toISOString();
  return { sourceId: 'development-fixture', sourceRecordId: id, canonicalUrl: `https://example.invalid/teaching/${id}`, publishedAt: published,
    providerAt: new Date(Date.parse(published) + (revision - 1) * 1000).toISOString(), ingestedAt: new Date().toISOString(),
    isSynthetic: true, isDelayed: true, delayMs: 1000, revision, category: 'TEACHING FIXTURE', symbols: ['NOVA'],
    title: revision === 1 ? `Fixture ${id}: NOVA raises guidance for a fictional laboratory` : `Correction ${id}: NOVA cuts guidance for a fictional laboratory`,
    summary: 'Fictional teaching fixture. No real event or investment conclusion is implied.' };
}
export async function injectFixture(repository: ReturnType<typeof ingestionRepository>, input: { id: string; revision: number; publishedAt: string }, environment: NodeJS.ProcessEnv = process.env) {
  assertFixtureEnvironment(environment);
  const article = fixtureArticle(input.id, input.revision, input.publishedAt);
  // A distinct schedule permits immediate repeat injection without altering the ordinary worker's lease.
  const key = `dev-fixture:${randomUUID()}`;
  await repository.initialize(key);
  const lease = await repository.acquire(key, randomUUID());
  if (!lease) throw new Error('Fixture lease unavailable');
  const identity = { sourceId: article.sourceId, mode: 'mock' as const, capabilities: { delivery: 'polling' as const, timeliness: 'delayed' as const, delayMs: 1000, pagination: false, checkpoints: true, corrections: true } };
  const news: NewsProvider = { ...identity, getNews: async () => ({ articles: [article], nextCursor: null, checkpoint: `${input.id}:${input.revision}`, fetchedAt: new Date().toISOString() }) };
  const quotes: QuoteProvider = { ...identity, getQuotes: async () => ({ quotes: [], missing: [], checkpoint: '', fetchedAt: new Date().toISOString() }) };
  const result = await ingestOnce(repository, lease, { news, quotes }, 1000);
  if (result !== 'committed') throw new Error('Fixture ingestion failed; durable retry state retained.');
  return result;
}

