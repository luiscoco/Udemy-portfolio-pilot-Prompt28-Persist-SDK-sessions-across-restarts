import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from 'redis';
import { PrismaClient } from './generated/prisma/client.js';



function validatedUrl(value: string, protocols: string[], name: string): string {
  try {
    const url = new URL(value);
    if (protocols.includes(url.protocol) && url.hostname && !url.hash) return value;
  } catch { /* handled below */ }
  throw new Error(`${name} must be a valid ${protocols.join(' or ')} URL`);
}

const RETRIES = 3;
const RETRY_DELAY_MS = 200;
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}

let database: PrismaClient | undefined;
let redis: ReturnType<typeof createClient> | undefined;

export async function getDatabase(databaseUrl: string): Promise<PrismaClient> {
  validatedUrl(databaseUrl, ['postgresql:', 'postgres:'], 'DATABASE_URL');
  if (!database) {
    const adapter = new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
    const candidate = new PrismaClient({ adapter });
    try {
      await retry(() => candidate.$connect());
      database = candidate;
    } catch (error) {
      await candidate.$disconnect();
      throw error;
    }
  }
  return database;
}

export async function getRedis(redisUrl: string) {
  validatedUrl(redisUrl, ['redis:', 'rediss:'], 'REDIS_URL');
  if (redis && !redis.isOpen) redis = undefined;
  if (!redis) {
    const candidate = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries >= RETRIES ? false : RETRY_DELAY_MS * (retries + 1)
      }
    });
    candidate.on('error', () => { /* readiness reports connection failure without logging credentials */ });
    try {
      await candidate.connect();
      redis = candidate;
    } catch (error) {
      candidate.destroy();
      throw error;
    }
  }
  return redis;
}

export async function checkDatabase(databaseUrl: string): Promise<boolean> {
  try {
    const client = await getDatabase(databaseUrl);
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch { return false; }
}

export async function checkRedis(redisUrl: string): Promise<boolean> {
  try { return (await (await getRedis(redisUrl)).ping()) === 'PONG'; }
  catch { return false; }
}

export async function closeConnections(): Promise<void> {
  const currentRedis = redis;
  const currentDatabase = database;
  redis = undefined;
  database = undefined;
  if (currentRedis?.isOpen) await currentRedis.close();
  await currentDatabase?.$disconnect();
}

export { authenticateOwner, ownerRepositories } from './repositories.js';
export type { AuthenticatedOwner } from './repositories.js';
export { portfolioService, PortfolioError } from './portfolio-service.js';
export { summaryService } from './summary-service.js';
export { watchlistService } from './watchlist-service.js';
export { ingestionRepository, canonicalUrl } from './ingestion.js';
export type { Lease } from './ingestion.js';

export { appendEvent, buildEvent, outboxRepository, uuidV5, OUTBOX_POLICY } from './outbox.js';
export type { ClaimedEvent, NewAppEvent, OutboxRepository } from './outbox.js';
export { createCache, invalidateForEvent, jitteredTtl, CACHE_POLICIES, GENERATION_TTL_MS, SINGLE_FLIGHT } from './cache.js';
export type { Cache, CachePolicy, CacheOptions } from './cache.js';
export { redisKeys, safeKeyId, KEY_SCHEMA_VERSION } from './redis-keys.js';
export type { RedisClient, RedisKeys } from './redis-keys.js';
export { publishEvent, readEvents, currentCursor, streamEpoch, encodeCursor, decodeCursor, compareEntryIds, consumeOnce, EventDeduper, STREAM_RETENTION } from './event-stream.js';
export type { StreamRead, StreamScope } from './event-stream.js';
export { quoteReads, newsReads } from './cached-reads.js';
export { recoverySnapshot } from './recovery.js';
export { agentToolReads } from './agent-tool-reads.js';
export type { AgentToolReads } from './agent-tool-reads.js';
export { chatService } from './chat-service.js';
export type { ChatService, RunOutcome, SessionBinding } from './chat-service.js';
export { researchService, sharedAnalyses, invalidateArticleResearch, articleRevisionKey, analysisCacheKey, RESEARCH_CACHE_POLICY } from './research-service.js';
export type { AnalysisInput, AnalysisRunOutcome, AnalyzerBinding, EnsuredAnalysis, ResearchService } from './research-service.js';
export { ownerInterest } from './news-service.js';

export { alertService, processResearchNews } from './alert-service.js';

export * from './approval-service.js';

export * from './run-lease.js';
export * from './run-progress.js';
export * from './agent-jobs.js';
export { ownerForAgentRun } from './repositories.js';
