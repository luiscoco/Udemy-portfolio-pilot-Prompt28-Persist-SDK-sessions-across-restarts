import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockArticleAnalyzer, type ArticleAnalysisInput } from '@portfolio-pilot/agent';
import { articleImpactResultSchema, recommendationListSchema, type ArticleImpact } from '@portfolio-pilot/contracts';
import { authenticateOwner, closeConnections, getDatabase, ingestionRepository, portfolioService, researchService } from '@portfolio-pilot/db';
import type { Article } from '@portfolio-pilot/providers';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { POST as signIn } from '../app/api/auth/[...all]/route';
import { GET as getImpact, POST as postImpact } from '../app/api/news/[id]/impact/route';
import { GET as listRecommendations } from '../app/api/recommendations/route';
import { analyzerBinding } from './research';

/**
 * Milestone 21 acceptance against real PostgreSQL: one shared analysis per article revision, private
 * per-owner exposure and recommendations, rejection of unsupported sources, visible stale evidence,
 * invalidation on corrections and portfolio changes, and no repeated model run for duplicate deliveries.
 */
const databaseUrl = process.env.RESEARCH_TEST_DATABASE_URL;
const origin = 'http://localhost:5173';
const run = `m21-${randomUUID().slice(0, 8)}`;
const symbol = `M21${run.slice(4, 10).toUpperCase()}`;
const ids = { s: `${run}-s`, o: `${run}-o`, a: `${run}-a`, b: `${run}-b`, carol: `${run}-carol` };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../packages/agent/test/fixtures/research/${name}.json`, import.meta.url), 'utf8'));
const contradictory = fixture('contradictory-articles');
const neutral = fixture('neutral-news');
const unsupported = fixture('unsupported-source');
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);
/** Fixed once: a real duplicate delivery repeats the same publication time. */
const ingestedPublishedAt = hoursAgo(3).toISOString();
const request = (path: string, cookie = '', method = 'GET') => new Request(`${origin}/api/${path}`, { method, headers: { cookie, origin, 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** The deterministic mock analyzer with latency, so concurrent callers really overlap. */
class SlowAnalyzer extends MockArticleAnalyzer {
  override async analyze(input: ArticleAnalysisInput) { await new Promise(resolve => setTimeout(resolve, 60)); return super.analyze(input); }
}
/** Returns an analysis that cites an extra, unsupported source. */
class ForeignSourceAnalyzer extends MockArticleAnalyzer {
  override async analyze(input: ArticleAnalysisInput) { const good = await super.analyze(input); return { ...good, sources: [...good.sources, { articleId: 'invented-article', url: 'https://attacker.example/invented' }] }; }
}

describe.skipIf(!databaseUrl)('portfolio impact and research recommendations against PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let aliceCookie = '', bobCookie = '';
  const analyzer = new SlowAnalyzer();
  const binding = analyzerBinding(analyzer);
  let alice: ReturnType<typeof researchService>, bob: ReturnType<typeof researchService>, carol: ReturnType<typeof researchService>;
  const article = (key: string) => `${run}-${key}`;
  const types = (impact: ArticleImpact) => impact.recommendations.map(r => r.type);
  const holding = (impact: ArticleImpact) => impact.exposure!.holdings.find(h => h.securityId === ids.s);

  async function createArticle(key: string, data: { provider?: string; title: string; summary: string; publishedAt: Date }) {
    await db.newsArticle.create({ data: { id: article(key), provider: data.provider ?? 'portfolio-pilot-mock', providerArticleId: article(key), title: data.title.replace(/ACME/g, symbol), summary: data.summary.replace(/ACME/g, symbol),
      url: `https://example.com/m21/${run}/${key}`, publishedAt: data.publishedAt, isSynthetic: true, securities: { create: [{ securityId: ids.s }] } } });
  }
  let deliveries = 0;
  async function deliver(input: Partial<Article> & Pick<Article, 'sourceRecordId' | 'providerAt' | 'title' | 'revision'>) {
    const repository = ingestionRepository(db); const key = `${run}-ingest-${deliveries++}`;
    const item: Article = { sourceId: 'portfolio-pilot-mock', ingestedAt: input.providerAt, isDelayed: true, delayMs: 1000, isSynthetic: true, canonicalUrl: `https://example.com/m21/${run}/ingested`,
      publishedAt: ingestedPublishedAt, summary: 'Fictional teaching fixture about a product line.', category: 'MARKET UPDATE', symbols: [symbol], ...input };
    await repository.initialize(key); const lease = (await repository.acquire(key, run))!;
    await repository.commit(lease, { articles: [item], fetchedAt: item.ingestedAt, checkpoint: '', nextCursor: null }, { quotes: [], missing: [], fetchedAt: item.ingestedAt, checkpoint: '' }, 1000);
    return (await db.newsSource.findUniqueOrThrow({ where: { provider_recordId: { provider: 'portfolio-pilot-mock', recordId: input.sourceRecordId } } })).articleId;
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/portfolio_m21_verify') throw new Error('Use the dedicated loopback portfolio_m21_verify database.');
    vi.stubEnv('DATABASE_URL', databaseUrl!); vi.stubEnv('REDIS_URL', ''); vi.stubEnv('DATA_MODE', 'mock'); vi.stubEnv('AGENT_MODE', 'mock');
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DEMO_AUTH_ENABLED', 'true');
    vi.stubEnv('AUTH_BASE_URL', origin); vi.stubEnv('AUTH_SECRET', 'local-session-verification-secret-only-1234567890');
    db = await getDatabase(databaseUrl!); await seedDemo(db);
    for (const account of ['alice', 'bob']) {
      const response = await signIn(new Request(`${origin}/api/auth/demo-sign-in`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ account }) }));
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find(c => c.startsWith('better-auth.session_token='))!.split(';')[0]!;
      if (account === 'alice') aliceCookie = cookie; else bobCookie = cookie;
    }
    for (const [id, sym] of [[ids.s, symbol], [ids.o, `${symbol}O`]] as const) {
      await db.security.create({ data: { id, symbol: sym, exchangeMic: 'XNAS', name: `Fictional ${sym}`, currency: 'USD' } });
      await db.quoteSnapshot.create({ data: { securityId: id, price: '100', currency: 'USD', provider: 'm21-fixture', asOf: new Date(), isSynthetic: true } });
    }
    const buy = (securityId: string, quantity: string, day: number) => ({ securityId, side: 'BUY' as const, quantity, price: '100', fees: '0', amount: String(Number(quantity) * 100), occurredAt: new Date(Date.UTC(2025, 1, day)) });
    // Alice: the security is 60% of this portfolio (concentrated). Bob: 10% (diversified). Carol: watchlist only.
    await db.portfolio.create({ data: { id: ids.a, ownerId: 'demo-alice', name: `${run} Alice`, transactions: { create: [buy(ids.s, '6', 1), buy(ids.o, '4', 2)] } } });
    await db.portfolio.create({ data: { id: ids.b, ownerId: 'demo-bob', name: `${run} Bob`, transactions: { create: [buy(ids.s, '1', 1), buy(ids.o, '9', 2)] } } });
    await db.user.create({ data: { id: ids.carol, name: 'Carol Fixture', email: `${ids.carol}@example.invalid`, watchlist: { create: [{ securityId: ids.s }] } } });
    const owner = async (userId: string) => { const token = randomUUID(); await db.session.create({ data: { token, userId, expiresAt: new Date(Date.now() + 3600_000) } }); return authenticateOwner(db, token); };
    alice = researchService(db, await owner('demo-alice'), binding);
    bob = researchService(db, await owner('demo-bob'), binding);
    carol = researchService(db, await owner(ids.carol), binding);
    for (const a of contradictory.articles) await createArticle(a.key, { title: a.title, summary: a.summary, publishedAt: hoursAgo(a.publishedHoursAgo) });
    await createArticle('neutral', { title: neutral.article.title, summary: neutral.article.summary, publishedAt: hoursAgo(neutral.article.publishedHoursAgo) });
    await createArticle('aged', { title: 'ACME announces an acquisition of a supplier', summary: 'Fictional teaching fixture. The acquisition was announced ten days ago.', publishedAt: hoursAgo(240) });
    await createArticle('unsupported', { provider: unsupported.unsupportedProviderArticle.provider, title: unsupported.unsupportedProviderArticle.title, summary: unsupported.unsupportedProviderArticle.summary, publishedAt: hoursAgo(1) });
    await createArticle('foreign', { title: 'ACME raises its dividend outlook', summary: 'Fictional teaching fixture.', publishedAt: hoursAgo(200) });
  });
  afterAll(async () => {
    if (db) {
      await db.recommendation.deleteMany({ where: { OR: [{ ownerId: ids.carol }, { articleId: { startsWith: run } }, { evidenceArticleIds: { hasSome: await db.newsArticle.findMany({ where: { url: { startsWith: `https://example.com/m21/${run}/` } }, select: { id: true } }).then(rows => rows.map(r => r.id)) } }] } });
      await db.newsArticle.deleteMany({ where: { url: { startsWith: `https://example.com/m21/${run}/` } } });
      await db.portfolio.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
      await db.user.deleteMany({ where: { id: ids.carol } });
      await db.security.deleteMany({ where: { id: { in: [ids.s, ids.o] } } });
    }
    vi.unstubAllEnvs(); await closeConnections();
  });

  it('gives the same article different relevance per owner from ONE shared analysis, with exact exposure', async () => {
    const id = article('raise');
    // Four concurrent requests from three owners: the analyzer runs exactly once.
    const [a, b, c, again] = await Promise.all([alice.recalculate(id), bob.recalculate(id), carol.recalculate(id), alice.recalculate(id)]);
    expect(analyzer.calls).toBe(1);
    expect(new Set([a, b, c, again].map(i => i.analysis!.id)).size).toBe(1);
    expect(a.analysis).toMatchObject({ status: 'completed', promptVersion: 'article-analysis-prompt-v1', schemaVersion: 'article-analysis-v1', modelKey: 'mock:article-rules-v1', analysis: { sentiment: { label: 'positive' }, materiality: 'medium' } });

    // Demo positions have 2025 quotes (stale), so every owner's weights use cost basis consistently.
    expect(a).toMatchObject({ state: 'current', exposure: { relevance: 'held', basis: 'cost_basis', affectedValue: '600.00', totalValue: '2002.76', weight: '0.2995865705', largestHoldingWeight: '0.6000000000' } });
    expect(holding(a)).toMatchObject({ portfolioId: ids.a, quantity: '6.0000000000', value: '600.00', weight: '0.6000000000', valueBasis: 'cost_basis' });
    expect(b).toMatchObject({ state: 'current', exposure: { relevance: 'held', affectedValue: '100.00', totalValue: '2351.50', weight: '0.0425260472', largestHoldingWeight: '0.1000000000' } });
    expect(c).toMatchObject({ state: 'current', exposure: { relevance: 'watchlisted', holdings: [], watchlistedSecurityIds: [ids.s] } });
    expect(types(a)).toEqual(['monitor_event', 'review_concentration']);
    expect(types(b)).toEqual(['monitor_event']);
    expect(types(c)).toEqual(['monitor_event']);
    expect(c.recommendations[0]!.affectedSecurities).toEqual([{ securityId: ids.s, symbol, relation: 'watchlisted' }]);
    for (const r of [...a.recommendations, ...b.recommendations, ...c.recommendations]) {
      expect(r).toMatchObject({ status: 'active', staleReasons: [], sentiment: { label: 'positive' } });
      expect(r.rationale.length && r.evidence.length && r.uncertainties.length && r.counterarguments.length).toBeTruthy();
      expect(r.evidence.every(e => e.articleId === id && e.status === 'current' && e.analysisId === a.analysis!.id)).toBe(true);
      expect(Date.parse(r.asOf)).toBeGreaterThan(0);
    }

    // Private conclusions never live under the shared key: the shared row has no owner data at all.
    const shared = await db.articleAnalysis.findUniqueOrThrow({ where: { id: a.analysis!.id } });
    expect(JSON.stringify(shared)).not.toMatch(new RegExp(['demo-alice', 'demo-bob', ids.carol, ids.a, ids.b, 'Alice', 'Bob', 'Carol', '600.00', 'weight'].join('|')));
    // Each owner sees only their own recommendations.
    const bobIds = new Set(b.recommendations.map(r => r.id));
    expect(a.recommendations.some(r => bobIds.has(r.id))).toBe(false);
    expect((await bob.list()).some(r => a.recommendations.some(x => x.id === r.id))).toBe(false);
    await expect(bob.impact('demo-acme-xnas-news')).rejects.toThrow('Resource not found');
  });

  it('reuses the cached analysis for repeated and duplicate deliveries and does not duplicate recommendations', async () => {
    const before = analyzer.calls;
    const first = await alice.recalculate(article('raise'));
    expect(first.analysisReused).toBe(true);
    const ingested = await deliver({ sourceRecordId: `${run}-rec`, providerAt: hoursAgo(2.5).toISOString(), title: `${symbol} unveils a new product line`, revision: 1 });
    await alice.recalculate(ingested);
    expect(analyzer.calls).toBe(before + 1);
    // The same content again, from another provider record (an at-least-once duplicate): same revision key.
    expect(await deliver({ sourceRecordId: `${run}-rec-duplicate`, providerAt: hoursAgo(2.5).toISOString(), title: `${symbol} unveils a new product line`, revision: 1 })).toBe(ingested);
    const again = await Promise.all([alice.recalculate(ingested), bob.recalculate(ingested)]);
    expect(analyzer.calls).toBe(before + 1);
    expect(again.every(i => i.analysisReused && i.state === 'current')).toBe(true);
    expect(await db.articleAnalysis.count({ where: { articleId: ingested } })).toBe(1);
    expect(await db.recommendation.count({ where: { ownerId: 'demo-alice', articleId: article('raise') } })).toBe(2);
  });

  it('invalidates on a correction: stale and corrected evidence are visible until recalculation supersedes them', async () => {
    const ingested = (await db.newsSource.findUniqueOrThrow({ where: { provider_recordId: { provider: 'portfolio-pilot-mock', recordId: `${run}-rec` } } })).articleId;
    const before = await alice.impact(ingested);
    expect(before.state).toBe('current');
    const oldAnalysis = before.analysis!.id;
    await deliver({ sourceRecordId: `${run}-rec`, providerAt: hoursAgo(1).toISOString(), title: `Correction: ${symbol} delays the product line launch`, revision: 2 });
    // Ingestion committed the correction and, in the same transaction, superseded the analysis and staled the recommendations.
    expect((await db.articleAnalysis.findUniqueOrThrow({ where: { id: oldAnalysis } })).supersededAt).not.toBeNull();
    expect(await db.recommendation.count({ where: { articleId: ingested, status: 'stale', staleReasons: { array_contains: ['article_corrected'] } } })).toBeGreaterThan(0);
    const stale = await alice.impact(ingested);
    expect(stale).toMatchObject({ state: 'stale', staleReasons: ['article_corrected'] });
    expect(stale.recommendations.every(r => r.status === 'stale' && r.evidence.every(e => e.status === 'corrected'))).toBe(true);
    expect(stale.analysis).toMatchObject({ id: oldAnalysis });
    expect(stale.analysis!.supersededAt).not.toBeNull();

    const calls = analyzer.calls;
    const fresh = await alice.recalculate(ingested);
    expect(analyzer.calls).toBe(calls + 1);
    expect(fresh).toMatchObject({ state: 'current', staleReasons: [], analysisReused: false, analysis: { supersededAt: null, analysis: { sentiment: { label: 'negative' }, primarySource: { recommended: true } } } });
    expect(fresh.analysis!.id).not.toBe(oldAnalysis);
    expect(fresh.recommendations.every(r => r.status === 'active' && r.evidence.every(e => e.status === 'current'))).toBe(true);
    expect(await db.recommendation.count({ where: { ownerId: 'demo-alice', articleId: ingested, status: 'superseded' } })).toBeGreaterThan(0);
    // Bob's recommendations from the old revision stay visibly stale until Bob recalculates.
    expect((await bob.impact(ingested)).state).toBe('stale');
  });

  it('invalidates on a portfolio change and recalculates exposure without re-running the model', async () => {
    const id = article('raise');
    await portfolioService(db, (await authenticateOwnerFor('demo-alice'))).record(ids.a, { security: { symbol: `${symbol}O`, exchangeMic: 'XNAS', currency: 'USD' }, side: 'BUY', quantity: '2', price: '100', fees: '0', occurredAt: hoursAgo(1).toISOString() }, `${run}-buy-o`);
    const stale = await alice.impact(id);
    expect(stale).toMatchObject({ state: 'stale', staleReasons: ['portfolio_changed'] });
    expect(stale.recommendations.every(r => r.status === 'stale' && r.staleReasons.includes('portfolio_changed'))).toBe(true);
    expect((await alice.list({ status: 'stale' })).some(r => r.articleId === id)).toBe(true);
    expect((await bob.impact(id)).state).toBe('current');
    const calls = analyzer.calls;
    const fresh = await alice.recalculate(id);
    expect(analyzer.calls).toBe(calls);
    expect(fresh).toMatchObject({ state: 'current', analysisReused: true, exposure: { totalValue: '2202.76', weight: '0.2723855527', largestHoldingWeight: '0.5000000000' } });
    // The corrected (now negative) ingested report contradicts this positive one, so the recalculation adds both research steps.
    expect(types(fresh)).toEqual(['monitor_event', 'review_concentration', 'read_primary_source', 'reassess_assumptions']);
    const ingested = (await db.newsSource.findUniqueOrThrow({ where: { provider_recordId: { provider: 'portfolio-pilot-mock', recordId: `${run}-rec` } } })).articleId;
    expect(fresh.recommendations.find(r => r.type === 'reassess_assumptions')!.evidence.map(e => e.articleId)).toContain(ingested);
  });

  it('turns the contradictory fixtures into reassessment, and suggests nothing for neutral news', async () => {
    const cut = await alice.recalculate(article('cut'));
    expect(types(cut)).toEqual(contradictory.expectedRecommendations.concentratedHolderOfCut);
    const reassess = cut.recommendations.find(r => r.type === 'reassess_assumptions')!;
    expect(new Set(reassess.evidence.map(e => e.articleId))).toEqual(new Set([article('cut'), article('raise')]));
    expect(reassess.counterarguments.some(c => c.startsWith('Opposing report'))).toBe(true);
    expect(types(await bob.recalculate(article('cut')))).toEqual(contradictory.expectedRecommendations.diversifiedHolderOfCut);
    expect(types(await carol.recalculate(article('cut')))).toEqual(contradictory.expectedRecommendations.watcherOfCut);

    const quiet = await alice.recalculate(article('neutral'));
    expect(quiet).toMatchObject({ state: 'current', recommendations: [], exposure: { relevance: 'held' }, analysis: { analysis: { sentiment: { label: 'neutral' }, materiality: 'none' } } });
  });

  it('rejects unsupported sources before analysis and analyses that cite other sources', async () => {
    const calls = analyzer.calls;
    const rejected = await alice.recalculate(article('unsupported'));
    expect(rejected).toMatchObject({ state: 'unsupported_source', failureCode: 'unsupported_source', analysis: null, recommendations: [] });
    expect(analyzer.calls).toBe(calls);
    expect(await db.articleAnalysis.count({ where: { articleId: article('unsupported') } })).toBe(0);

    const hostile = new ForeignSourceAnalyzer();
    const service = researchService(db, await authenticateOwnerFor('demo-alice'), { ...analyzerBinding(hostile), modelKey: 'mock:foreign-source-test' });
    const failed = await service.recalculate(article('foreign'));
    expect(failed).toMatchObject({ state: 'analysis_failed', failureCode: 'analysis_unknown_source', recommendations: [], analysis: { status: 'failed', attempts: 2, analysis: null } });
    expect(hostile.calls).toBe(2);
    // A failed analysis is not retried on every delivery: the next request reuses the failure until retryAfter.
    expect(await service.recalculate(article('foreign'))).toMatchObject({ state: 'analysis_failed', analysisReused: true });
    expect(hostile.calls).toBe(2);
    expect(await db.recommendation.count({ where: { articleId: article('foreign') } })).toBe(0);
  });

  it('labels aged evidence and serves owner-scoped results over HTTP', async () => {
    const id = article('aged');
    const unauthenticated = await getImpact(request(`news/${id}/impact`), params(id));
    expect(unauthenticated.status).toBe(401);
    const before = articleImpactResultSchema.parse(await (await getImpact(request(`news/${id}/impact`, aliceCookie), params(id))).json()).impact;
    expect(before).toMatchObject({ state: 'not_analyzed', recommendations: [], exposure: null });
    const posted = await postImpact(request(`news/${id}/impact`, aliceCookie, 'POST'), params(id));
    expect(posted.status).toBe(200);
    const impact = articleImpactResultSchema.parse(await posted.json()).impact;
    expect(impact.state).toBe('current');
    expect(impact.recommendations.length).toBeGreaterThan(0);
    expect(impact.recommendations.every(r => r.evidence.every(e => e.status === 'aged'))).toBe(true);
    expect(impact.policy).toEqual({ evidenceAgedAfterMs: 259200000, concentrationThreshold: '0.2', generatorVersion: 'research-rules-v1' });

    const aliceList = recommendationListSchema.parse(await (await listRecommendations(request('recommendations?status=open&limit=50', aliceCookie))).json());
    const bobList = recommendationListSchema.parse(await (await listRecommendations(request('recommendations?limit=50', bobCookie))).json());
    expect(aliceList.recommendations.some(r => r.articleId === id)).toBe(true);
    expect(bobList.recommendations.some(r => aliceList.recommendations.some(x => x.id === r.id))).toBe(false);
    expect((await getImpact(request('news/demo-acme-xnas-news/impact', bobCookie), params('demo-acme-xnas-news'))).status).toBe(404);
    expect((await postImpact(request(`news/${id}/impact`, '', 'POST'), params(id))).status).toBe(401);
  });

  it('invalidates unchanged net quantities after a sell/rebuy and after portfolio metadata changes', async () => {
    const id = article('raise');
    await alice.recalculate(id);
    const calls = analyzer.calls;
    const service = portfolioService(db, await authenticateOwnerFor('demo-alice'));
    const trade = { security: { symbol, exchangeMic: 'XNAS', currency: 'USD' }, quantity: '1', fees: '0' };
    await service.record(ids.a, { ...trade, side: 'SELL', price: '100', occurredAt: hoursAgo(0.5).toISOString() }, `${run}-sell`);
    await service.record(ids.a, { ...trade, side: 'BUY', price: '200', occurredAt: hoursAgo(0.25).toISOString() }, `${run}-rebuy`);
    expect(await alice.impact(id)).toMatchObject({ state: 'stale', staleReasons: ['portfolio_changed'] });
    const fresh = await alice.recalculate(id);
    expect(analyzer.calls).toBe(calls);
    expect(holding(fresh)).toMatchObject({ quantity: '6.0000000000', value: '700.00' });
    await db.portfolio.update({ where: { id: ids.a }, data: { name: `${run} Renamed` } });
    expect(await alice.impact(id)).toMatchObject({ state: 'stale', staleReasons: ['portfolio_changed'] });
  });

  it('rejects an unsupported accepted observation even when the canonical provider was allowed', async () => {
    await createArticle('provider-switch', { title: 'ACME raises guidance', summary: 'Fictional teaching report.', publishedAt: hoursAgo(1) });
    const id = article('provider-switch');
    const first = await alice.recalculate(id);
    const calls = analyzer.calls;
    const observationId = `${run}-untrusted-observation`;
    await db.newsObservation.create({ data: { id: observationId, articleId: id, provider: 'unknown-blog', recordId: observationId, fingerprint: observationId, providerAt: new Date(), metadata: {} } });
    await db.newsArticle.update({ where: { id }, data: { acceptedObservationId: observationId } });
    const rejected = await alice.recalculate(id);
    expect(rejected).toMatchObject({ state: 'unsupported_source', failureCode: 'unsupported_source' });
    expect(rejected.recommendations.every(r => r.status === 'stale' && r.evidence.filter(e => e.articleId === id).every(e => e.status === 'corrected'))).toBe(true);
    expect(analyzer.calls).toBe(calls);
    expect(rejected.analysis!.id).toBe(first.analysis!.id);
  });

  it('recalculates with separate shared keys when the model or prompt configuration changes', async () => {
    const owner = await authenticateOwnerFor('demo-bob');
    const variant = new MockArticleAnalyzer();
    const original = await bob.recalculate(article('neutral'));
    const changed = researchService(db, owner, { ...analyzerBinding(variant), modelKey: 'mock:configuration-test', promptVersion: 'article-analysis-prompt-test' });
    expect(await changed.impact(article('neutral'))).toMatchObject({ state: 'stale', staleReasons: ['analysis_version_changed'] });
    const fresh = await changed.recalculate(article('neutral'));
    expect(fresh).toMatchObject({ state: 'current', recommendations: [], analysisReused: false });
    expect(variant.calls).toBe(1);
    expect(fresh.analysis!.id).not.toBe(original.analysis!.id);
  });

  it('uses the PostgreSQL claim when independent process-local caches overlap', async () => {
    await createArticle('claim', { title: 'ACME raises guidance', summary: 'Fictional report.', publishedAt: hoursAgo(1) });
    const separateProcess = new Proxy(db, { get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    const competing = researchService(separateProcess, await authenticateOwnerFor('demo-bob'), binding);
    const calls = analyzer.calls;
    const [a, b] = await Promise.all([alice.recalculate(article('claim')), competing.recalculate(article('claim'))]);
    expect(analyzer.calls).toBe(calls + 1);
    expect(a.analysis!.id).toBe(b.analysis!.id);
    expect(await db.articleAnalysis.count({ where: { articleId: article('claim') } })).toBe(1);
  });

  async function authenticateOwnerFor(userId: string) {
    const token = randomUUID(); await db.session.create({ data: { token, userId, expiresAt: new Date(Date.now() + 3600_000) } });
    return authenticateOwner(db, token);
  }
});
