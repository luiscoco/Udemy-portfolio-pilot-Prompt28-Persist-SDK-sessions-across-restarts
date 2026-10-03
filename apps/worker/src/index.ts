import { runAgentWorker } from './agent.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { closeConnections, getDatabase, getRedis, ingestionRepository, outboxRepository, publishEvent, redisKeys } from '@portfolio-pilot/db';
import { selectProviders } from '@portfolio-pilot/providers';
import { AlpacaQuoteProvider, AlpacaNewsProvider } from '@portfolio-pilot/providers/server';
import { ingestOnce } from './ingestion.js';
import { dispatchOnce } from './outbox.js';
import { processResearchNews } from '@portfolio-pilot/db';
import { analyzeArticle, ARTICLE_ANALYSIS_PROMPT_VERSION, ClaudeArticleAnalyzer, MockArticleAnalyzer } from '@portfolio-pilot/agent';
import { ARTICLE_ANALYSIS_SCHEMA_VERSION } from '@portfolio-pilot/contracts';

const config = parseServerConfig(process.env);
const role = process.env.WORKER_ROLE || 'ingestion';
if (!['ingestion', 'outbox', 'agent'].includes(role)) throw new Error('Invalid WORKER_ROLE');
const abort = new AbortController();
function shutdown() { abort.abort(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('message', (message: unknown) => { if (message === 'shutdown') shutdown(); });
async function run() {
  console.log(`PortfolioPilot worker role: ${role}; data mode: ${config.DATA_MODE}`);
  if (role === 'outbox') return runOutbox();
  if (role === 'agent') return runAgentWorker(abort.signal);
  if (!config.DATABASE_URL) throw new Error('Ingestion requires DATABASE_URL');
  const repository = ingestionRepository(await getDatabase(config.DATABASE_URL));
  const key = config.DATA_MODE === 'mock' ? `mock:${config.MOCK_SCENARIO}:${config.MOCK_NEWS_INTERVAL_MS}` : 'alpaca-v1';
  const state = await repository.initialize(key, config.MOCK_START_AT ? new Date(config.MOCK_START_AT) : undefined);
  const liveOptions = { key: config.ALPACA_API_KEY ?? '', secret: config.ALPACA_API_SECRET ?? '', rightsConfirmed: config.ALPACA_STORAGE_DISPLAY_RIGHTS_CONFIRMED, timeoutMs: config.PROVIDER_TIMEOUT_MS };
  const live = config.DATA_MODE === 'live' ? { quotes: new AlpacaQuoteProvider(liveOptions), news: new AlpacaNewsProvider(liveOptions) } : undefined;
  const providers = selectProviders(config.DATA_MODE, { startAt: state.mockStartAt.toISOString(), intervalMs: config.MOCK_NEWS_INTERVAL_MS, scenario: config.MOCK_SCENARIO }, live);
  const owner = randomUUID();
  while (!abort.signal.aborted) {
    try {
      const lease = await repository.acquire(key, owner);
      if (lease) console.log(`Ingestion ${await ingestOnce(repository, lease, providers, config.INGESTION_INTERVAL_MS)}`);
    } catch { console.error('Ingestion database unavailable; retrying'); }
    if (process.env.WORKER_ONCE === 'true') break;
    await sleep(1000, undefined, { signal: abort.signal });
  }
}
async function runOutbox() {
  if (!config.DATABASE_URL || !config.REDIS_URL) throw new Error('Outbox dispatch requires DATABASE_URL and REDIS_URL');
  const db = await getDatabase(config.DATABASE_URL);
  const repository = outboxRepository(db);
  const analyzer = config.AGENT_MODE === 'mock' ? new MockArticleAnalyzer() : new ClaudeArticleAnalyzer({ apiKey: config.ANTHROPIC_API_KEY, modelId: config.AGENT_MODEL_ID!, workspaceDir: config.AGENT_WORKSPACE_DIR! });
  const binding = { mode: analyzer.mode, modelKey: analyzer.modelKey, promptVersion: ARTICLE_ANALYSIS_PROMPT_VERSION, schemaVersion: ARTICLE_ANALYSIS_SCHEMA_VERSION,
    run: (input: Parameters<typeof analyzeArticle>[1], signal?: AbortSignal) => analyzeArticle(analyzer, input, signal) };
  const keys = redisKeys();
  const options = { owner: randomUUID(), batchSize: config.OUTBOX_BATCH_SIZE, leaseMs: config.OUTBOX_LEASE_MS, maxAttempts: config.OUTBOX_MAX_ATTEMPTS, processNews: (id: string) => processResearchNews(db, id, binding) };
  let nextPurge = 0;
  while (!abort.signal.aborted) {
    let full = false;
    try {
      // getRedis reconnects lazily, so a Redis outage only delays delivery; events stay PENDING in PostgreSQL.
      const publish = async (event: Parameters<typeof publishEvent>[2]) => publishEvent(await getRedis(config.REDIS_URL!), keys, event);
      const result = await dispatchOnce(repository, publish, options);
      if (result.claimed) console.log(`Outbox ${JSON.stringify(result)}`);
      full = result.claimed === options.batchSize;
      if (Date.now() >= nextPurge) { await repository.purgePublished(); nextPurge = Date.now() + 600000; }
    } catch { console.error('Outbox database unavailable; retrying'); }
    if (process.env.WORKER_ONCE === 'true') break;
    if (!full) await sleep(config.OUTBOX_POLL_MS, undefined, { signal: abort.signal });
  }
}
try { await run(); }
catch { if (!abort.signal.aborted) { console.error('Worker configuration or startup failed'); process.exitCode = 1; } }
finally { await closeConnections(); if (process.connected) process.disconnect(); }
