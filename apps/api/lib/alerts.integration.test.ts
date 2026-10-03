import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { MockArticleAnalyzer } from '@portfolio-pilot/agent';
import { alertService, authenticateOwner, currentCursor, closeConnections, getDatabase, getRedis, ingestionRepository, outboxRepository, processResearchNews, publishEvent, readEvents, redisKeys, researchService } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { injectFixture } from '../../worker/src/fixture';
import { dispatchOnce } from '../../worker/src/outbox';
import { analyzerBinding } from './research';
import { POST as signIn } from '../app/api/auth/[...all]/route';
import { GET as notifications } from '../app/api/alerts/notifications/route';
import { PATCH as dismiss } from '../app/api/alerts/notifications/[id]/route';
import { PUT as editRule } from '../app/api/alerts/rules/[id]/route';
import { PATCH as disposition } from '../app/api/recommendations/[id]/route';
import { GET as history } from '../app/api/recommendations/route';

const url = process.env.ALERT_TEST_DATABASE_URL;
const origin = 'http://localhost:5173'; const run = `m22-${randomUUID().slice(0, 8)}`;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new Request(`${origin}/api/${path}`, { method, headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
describe.skipIf(!url)('milestone 22 durable news-to-recommendation alerts', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let alerts: ReturnType<typeof alertService>; let research: ReturnType<typeof researchService>;
  let cookie = '', bob = '', eventId = '', articleId = '', ruleId = '', notificationId = '', replayCursor = '';
  const binding = analyzerBinding(new MockArticleAnalyzer());
  const data = { name: run, enabled: true, securityIds: ['demo-nova'], categories: [], cooldownSeconds: 3600 };
  beforeAll(async () => {
    const target = new URL(url!); if (target.hostname !== '127.0.0.1' || target.pathname !== '/portfolio_m22_verify') throw new Error('Use dedicated portfolio_m22_verify');
    for (const [key, value] of Object.entries({ DATABASE_URL: url!, REDIS_URL: 'redis://127.0.0.1:6379', NODE_ENV: 'development', DATA_MODE: 'mock', AGENT_MODE: 'mock', DEMO_AUTH_ENABLED: 'true', AUTH_BASE_URL: origin, AUTH_SECRET: 'local-session-verification-secret-only-1234567890' })) vi.stubEnv(key, value);
    db = await getDatabase(url!); await seedDemo(db);
    await db.watchlistEntry.upsert({ where: { ownerId_securityId: { ownerId: 'demo-alice', securityId: 'demo-nova' } }, create: { ownerId: 'demo-alice', securityId: 'demo-nova' }, update: {} });
    for (const account of ['alice', 'bob']) {
      const response = await signIn(req('auth/demo-sign-in', '', 'POST', { account })); expect(response.status).toBe(200);
      const token = response.headers.getSetCookie().find(c => c.startsWith('better-auth.session_token='))!.split(';')[0]!;
      if (account === 'alice') cookie = token; else bob = token;
    }
    const token = randomUUID(); await db.session.create({ data: { token, userId: 'demo-alice', expiresAt: new Date(Date.now() + 3600000) } });
    const owner = await authenticateOwner(db, token); alerts = alertService(db, owner); research = researchService(db, owner, binding);
    ruleId = (await alerts.create(data)).id;
  });
  afterAll(async () => { if (db) { await db.alertRule.deleteMany({ where: { name: run } }); await db.outboxEvent.deleteMany({ where: { entityId: { in: [articleId, ruleId, notificationId] } } }); } vi.unstubAllEnvs(); await closeConnections(); });

  it('injects twice, computes private research and stores exactly one alert for concurrent/repeated delivery', async () => {
    const input = { id: run, revision: 1, publishedAt: new Date().toISOString() };
    await injectFixture(ingestionRepository(db), input); await injectFixture(ingestionRepository(db), input);
    articleId = (await db.newsSource.findUniqueOrThrow({ where: { provider_recordId: { provider: 'development-fixture', recordId: run } } })).articleId;
    const repo = outboxRepository(db);
    replayCursor = await currentCursor(await getRedis('redis://127.0.0.1:6379'), redisKeys(run), { kind: 'user', userId: 'demo-alice' });
    const publish = async (event: Parameters<typeof publishEvent>[2]) => publishEvent(await getRedis('redis://127.0.0.1:6379'), redisKeys(run), event);
    const options = { owner: run, batchSize: 100, leaseMs: 120000, maxAttempts: 8, processNews: (id: string) => processResearchNews(db, id, binding) };
    for (let i = 0; i < 4; i++) { const result = await dispatchOnce(repo, publish, options); expect(result.retried).toBe(0); }
    eventId = (await db.outboxEvent.findFirstOrThrow({ where: { type: 'news.available', ownerId: 'demo-alice', entityId: articleId } })).id;
    await Promise.all([processResearchNews(db, eventId, binding), processResearchNews(db, eventId, binding)]);
    const rows = await db.alertNotification.findMany({ where: { ruleId } }); expect(rows).toHaveLength(1); notificationId = rows[0]!.id;
    expect(rows[0]!.suppressed).toBe(false); expect(rows[0]!.recommendationIds.length).toBeGreaterThan(0);
    expect(await db.articleAnalysis.count({ where: { articleId } })).toBe(1);
    const created = await db.outboxEvent.findMany({ where: { type: 'research.updated', entityId: notificationId } }); expect(created).toHaveLength(1);
    const repeated = await db.outboxEvent.count({ where: { type: 'research.updated', ownerId: 'demo-alice', entityId: { in: rows[0]!.recommendationIds }, payload: { path: ['change'], equals: 'recommendation.created' } } });
    expect(repeated).toBe(rows[0]!.recommendationIds.length);
  });
  it('recovers owner-only notifications from PostgreSQL and replayable Redis without private stream payloads', async () => {
    const response = await notifications(req('alerts/notifications', cookie)); expect(response.status).toBe(200);
    expect((await response.json()).notifications.some((n: { id: string }) => n.id === notificationId)).toBe(true);
    const replay = await readEvents(await getRedis('redis://127.0.0.1:6379'), redisKeys(run), { kind: 'user', userId: 'demo-alice' }, replayCursor, 100);
    expect(JSON.stringify(replay)).toContain(notificationId);
    const privateResponse = await notifications(req('alerts/notifications', bob));
    expect(JSON.stringify(await privateResponse.json())).not.toContain(notificationId);
    expect((await dismiss(req('alerts/notifications/x', bob, 'PATCH'), context(notificationId))).status).toBe(404);
    expect((await editRule(req('alerts/rules/x', bob, 'PUT', data), context(ruleId))).status).toBe(404);
  });
  it('persists alert dismissal, saved/dismissed recommendations and private history after refetch', async () => {
    expect((await dismiss(req('alerts/notifications/x', cookie, 'PATCH'), context(notificationId))).status).toBe(200);
    expect((await alerts.notifications()).find(n => n.id === notificationId)?.dismissedAt).not.toBeNull();
    const id = (await db.alertNotification.findUniqueOrThrow({ where: { id: notificationId } })).recommendationIds[0]!;
    expect((await disposition(req('recommendations/x', cookie, 'PATCH', { disposition: 'saved' }), context(id))).status).toBe(200);
    expect((await research.list({ status: 'saved' })).some(r => r.id === id)).toBe(true);
    await disposition(req('recommendations/x', cookie, 'PATCH', { disposition: 'dismissed' }), context(id));
    await processResearchNews(db, eventId, binding);
    expect((await research.list()).some(r => r.id === id)).toBe(false);
    expect((await research.list({ status: 'history' })).find(r => r.id === id)?.disposition).toBe('dismissed');
    expect((await disposition(req('recommendations/x', bob, 'PATCH', { disposition: 'saved' }), context(id))).status).toBe(404);
    const foreign = await history(req('recommendations?status=history', bob)); expect(JSON.stringify(await foreign.json())).not.toContain(id);
  });
  it('keeps a cooldown suppression durable and evaluates a new rule revision only once', async () => {
    const revised = await alerts.edit(ruleId, { ...data, name: run }); expect(revised.revision).toBe(2);
    await processResearchNews(db, eventId, binding); await processResearchNews(db, eventId, binding);
    const rows = await db.alertNotification.findMany({ where: { ruleId }, orderBy: { ruleRevision: 'asc' } }); expect(rows).toHaveLength(2); expect(rows[1]!.suppressed).toBe(true);
    expect(await db.outboxEvent.count({ where: { entityId: rows[1]!.id } })).toBe(0);
    expect((await alerts.notifications()).filter(n => n.ruleId === ruleId)).toHaveLength(1);
    await alerts.remove(ruleId); expect((await alerts.rules()).some(r => r.id === ruleId)).toBe(false);
    expect((await alerts.notifications()).some(n => n.id === notificationId)).toBe(true);
  });
});

