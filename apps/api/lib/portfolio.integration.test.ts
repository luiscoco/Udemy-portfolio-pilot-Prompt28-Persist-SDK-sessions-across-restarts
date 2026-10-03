import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeConnections, getDatabase } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';
import { POST as signIn } from '../app/api/auth/[...all]/route';
import { GET as list, POST as create } from '../app/api/portfolios/route';
import { GET as get, PATCH as edit, DELETE as archive } from '../app/api/portfolios/[id]/route';
import { GET as history, POST as record } from '../app/api/portfolios/[id]/transactions/route';
import { GET as summary } from '../app/api/portfolios/[id]/summary/route';
import { GET as securities } from '../app/api/securities/route';
import { GET as watchlist, POST as addWatch } from '../app/api/watchlist/route';
import { PATCH as editWatch, DELETE as removeWatch } from '../app/api/watchlist/[id]/route';

const databaseUrl = process.env.PORTFOLIO_TEST_DATABASE_URL;
const origin = 'http://localhost:5173';
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const trade = { security: { symbol: 'ACME', exchangeMic: 'XNAS', currency: 'USD' }, side: 'BUY', quantity: '10', price: '100', fees: '2', occurredAt: '2025-01-02T00:00:00.000Z' };
describe.skipIf(!databaseUrl)('portfolio API PostgreSQL acceptance', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let alice = ''; let bob = ''; const ids: string[] = [];
  const request = (path: string, method = 'GET', body?: unknown, key?: string, cookie = alice, requestOrigin = origin) => new Request(`${origin}/api/${path}`, {
    method, headers: { cookie, origin: requestOrigin, 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const newPortfolio = async () => {
    const response = await create(request('portfolios', 'POST', { name: `m08-${crypto.randomUUID()}` }));
    expect(response.status).toBe(201);
    const id = (await response.json()).portfolio.id as string; ids.push(id); return id;
  };
  const post = (id: string, body = trade, key = crypto.randomUUID()) => record(request(`portfolios/${id}/transactions`, 'POST', body, key), context(id));
  it('provides exchange-aware securities and isolated idempotent watchlist CRUD', async () => {
    expect((await securities(request('securities', 'GET', undefined, undefined, ''))).status).toBe(401);
    const options = await (await securities(request('securities'))).json();
    expect(options.securities.filter((s: { symbol: string }) => s.symbol === 'ACME')).toHaveLength(2);
    // Disposable security avoids touching either demo user's existing watchlist.
    const stock = await db.security.create({ data: { symbol: `T${Date.now()}`, exchangeMic: 'XNAS', name: 'Watchlist acceptance', currency: 'USD' } });
    const alternate = await db.security.create({ data: { symbol: stock.symbol, exchangeMic: 'XNYS', name: 'Alternate exchange', currency: 'USD' } });
    try {
      const input = { securityId: stock.id };
      const first = await addWatch(request('watchlist', 'POST', input)); expect(first.status).toBe(201);
      const id = (await first.json()).entry.id;
      expect((await (await addWatch(request('watchlist', 'POST', input))).json()).entry.id).toBe(id);
      const other = await addWatch(request('watchlist', 'POST', input, undefined, bob)); expect(other.status).toBe(201);
      expect((await other.json()).entry.id).not.toBe(id);
      const bobs = await (await watchlist(request('watchlist', 'GET', undefined, undefined, bob))).json();
      expect(bobs.entries.some((entry: { id: string }) => entry.id === id)).toBe(false);
      expect((await editWatch(request(`watchlist/${id}`, 'PATCH', { securityId: alternate.id }, undefined, bob), context(id))).status).toBe(404);
      expect((await removeWatch(request(`watchlist/${id}`, 'DELETE', undefined, undefined, bob), context(id))).status).toBe(404);
      expect((await editWatch(request(`watchlist/${id}`, 'PATCH', { securityId: alternate.id }), context(id))).status).toBe(200);
      expect((await addWatch(request('watchlist', 'POST', { ...input, ownerId: 'demo-bob' }))).status).toBe(400);
      expect((await addWatch(request('watchlist', 'POST', { securityId: 'missing' }))).status).toBe(400);
      expect((await removeWatch(request(`watchlist/${id}`, 'DELETE'), context(id))).status).toBe(200);
      expect((await removeWatch(request(`watchlist/${id}`, 'DELETE'), context(id))).status).toBe(404);
    } finally {
      await db.watchlistEntry.deleteMany({ where: { securityId: { in: [stock.id, alternate.id] } } });
      await db.security.deleteMany({ where: { id: { in: [stock.id, alternate.id] } } });
    }
  });
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/portfolio_m08_verify') throw new Error('Use the dedicated local milestone 08 database.');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', databaseUrl!); vi.stubEnv('DEMO_AUTH_ENABLED', 'true'); vi.stubEnv('AUTH_BASE_URL', origin); vi.stubEnv('AUTH_SECRET', 'local-verification-secret-only-1234567890');
    db = await getDatabase(databaseUrl!); await seedDemo(db);
    for (const account of ['alice', 'bob']) {
      const response = await signIn(request('auth/demo-sign-in', 'POST', { account }, undefined, ''));
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find(c => c.startsWith('better-auth.session_token='))!.split(';')[0]!;
      if (account === 'alice') alice = cookie; else bob = cookie;
    }
  });
  afterAll(async () => {
    // Only this run's disposable resources, never the seeded ledger or application DB.
    if (db) await db.portfolio.deleteMany({ where: { id: { in: ids } } });
    vi.unstubAllEnvs(); await closeConnections();
  });
  it('requires sessions and trusted mutation origins', async () => {
    expect((await list(request('portfolios', 'GET', undefined, undefined, ''))).status).toBe(401);
    expect((await create(request('portfolios', 'POST', { name: 'forged' }, undefined, alice, 'https://evil.example'))).status).toBe(403);
    for (const body of [{ name: ' ' }, { name: 'x', currency: 'EUR' }, { name: 'x', ownerId: 'demo-bob' }]) {
      expect((await create(request('portfolios', 'POST', body))).status).toBe(400);
    }
  });
  it('summarizes the full ledger, preserves archived access, and isolates owners', async () => {
    const id = await newPortfolio();
    await post(id);
    await post(id, { ...trade, quantity: '5', price: '120', fees: '1', occurredAt: '2025-01-03T00:00:00.000Z' });
    await post(id, { ...trade, side: 'SELL', quantity: '6', price: '130', fees: '3', occurredAt: '2025-01-04T00:00:00.000Z' });
    const unpriced = (await (await summary(request(`portfolios/${id}/summary`), context(id))).json()).summary;
    expect(unpriced).toMatchObject({ valuationComplete: false, marketValue: null, unrealizedGainLoss: null, remainingCostBasis: '961.80' });
    const security = await db.security.findUniqueOrThrow({ where: { exchangeMic_symbol: { exchangeMic: 'XNAS', symbol: 'ACME' } } });
    const quote = await db.quoteSnapshot.create({ data: { securityId: security.id, provider: `m09-${id}`, price: '125', asOf: new Date(), isSynthetic: true } });
    try {
      const response = await summary(request(`portfolios/${id}/summary`), context(id));
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect((await response.json()).summary).toMatchObject({ remainingCostBasis: '961.80', soldCostBasis: '641.20', realizedGainLoss: '135.80', marketValue: '1125.00', unrealizedGainLoss: '163.20' });
      expect((await summary(request(`portfolios/${id}/summary`, 'GET', undefined, undefined, ''), context(id))).status).toBe(401);
      for (const foreign of [id, 'missing']) expect((await summary(request(`portfolios/${foreign}/summary`, 'GET', undefined, undefined, bob), context(foreign))).status).toBe(404);
      await archive(request(`portfolios/${id}`, 'DELETE'), context(id));
      expect((await summary(request(`portfolios/${id}/summary`), context(id))).status).toBe(200);
    } finally { await db.quoteSnapshot.delete({ where: { id: quote.id } }); }
  });
  it('CRUD retains archived history and isolates every resource method', async () => {
    const id = await newPortfolio();
    const name = (await (await get(request(`portfolios/${id}`), context(id))).json()).portfolio.name;
    expect((await create(request('portfolios', 'POST', { name }))).status).toBe(409);
    expect((await edit(request(`portfolios/${id}`, 'PATCH', { currency: 'EUR' }), context(id))).status).toBe(400);
    expect((await post(id)).status).toBe(200);
    expect((await edit(request(`portfolios/${id}`, 'PATCH', { name: `renamed-${id}` }), context(id))).status).toBe(200);
    for (const foreign of [id, 'missing']) {
      expect((await get(request(`portfolios/${foreign}`, 'GET', undefined, undefined, bob), context(foreign))).status).toBe(404);
      expect((await edit(request(`portfolios/${foreign}`, 'PATCH', { name: 'foreign' }, undefined, bob), context(foreign))).status).toBe(404);
      expect((await archive(request(`portfolios/${foreign}`, 'DELETE', undefined, undefined, bob), context(foreign))).status).toBe(404);
      expect((await history(request(`portfolios/${foreign}/transactions`, 'GET', undefined, undefined, bob), context(foreign))).status).toBe(404);
      expect((await record(request(`portfolios/${foreign}/transactions`, 'POST', trade, 'foreign', bob), context(foreign))).status).toBe(404);
    }
    expect((await archive(request(`portfolios/${id}`, 'DELETE'), context(id))).status).toBe(200);
    expect((await archive(request(`portfolios/${id}`, 'DELETE'), context(id))).status).toBe(200);
    expect((await post(id)).status).toBe(409);
    expect((await edit(request(`portfolios/${id}`, 'PATCH', { name: 'archived' }), context(id))).status).toBe(409);
    expect((await (await history(request(`portfolios/${id}/transactions`), context(id))).json()).transactions).toHaveLength(1);
    expect((await (await list(request('portfolios'))).json()).portfolios.some((p: { id: string }) => p.id === id)).toBe(true);
  });
  it('rejects invalid decimals, scope, identity, dates, and pagination without writes', async () => {
    const id = await newPortfolio();
    const invalid = [ { quantity: '0' }, { quantity: '-1' }, { quantity: 1 }, { price: '1e2' }, { price: '0' }, { fees: '-1' }, { fees: '0.00000000001' }, { quantity: '1000000000000000000' }, { occurredAt: '2025-02-30T00:00:00.000Z' }, { occurredAt: '2099-01-01T00:00:00.000Z' }, { occurredAt: '2025-01-01' }, { userId: 'demo-bob' }, { security: { ...trade.security, currency: 'EUR' } }, { security: { ...trade.security, symbol: 'UNKNOWN' } }, { security: { ...trade.security, exchangeMic: 'xxxx' } }, { side: 'SELL', fees: '1001' } ];
    for (const patch of invalid) expect((await post(id, { ...trade, ...patch } as typeof trade)).status).toBe(400);
    expect((await post(id, { ...trade, quantity: '999999999999999999', price: '999999999999999999' })).status).toBe(400);
    const malformed = new Request(`${origin}/api/portfolios/${id}/transactions`, { method: 'POST', headers: { cookie: alice, origin, 'content-type': 'application/json', 'Idempotency-Key': 'malformed' }, body: '{' });
    expect((await record(malformed, context(id))).status).toBe(400);
    expect((await record(request(`portfolios/${id}/transactions`, 'POST', trade), context(id))).status).toBe(400);
    expect((await history(request(`portfolios/${id}/transactions?limit=101`), context(id))).status).toBe(400);
    expect(await db.portfolioTransaction.count({ where: { portfolioId: id } })).toBe(0);
  });
  it('deduplicates simultaneous retries, normalizes decimals, and rejects key reuse', async () => {
    const id = await newPortfolio(); const key = crypto.randomUUID();
    const responses = await Promise.all([post(id, trade, key), post(id, trade, key)]);
    const bodies = await Promise.all(responses.map(r => r.json()));
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(bodies[0].transaction.id).toBe(bodies[1].transaction.id);
    expect(bodies.filter(b => b.replayed)).toHaveLength(1);
    expect((await post(id, { ...trade, quantity: '10.0', fees: '2.00' }, key)).status).toBe(200);
    expect((await post(id, { ...trade, price: '101' }, key)).status).toBe(409);
    await archive(request(`portfolios/${id}`, 'DELETE'), context(id));
    expect((await post(id, trade, key)).status).toBe(200);
    expect(await db.portfolioTransaction.count({ where: { portfolioId: id } })).toBe(1);
  });
  it('validates backdated changes against later sales and preserves equal-time posting order', async () => {
    const id = await newPortfolio();
    expect((await post(id, { ...trade, side: 'SELL' })).status).toBe(409);
    expect((await post(id)).status).toBe(200);
    expect((await post(id, { ...trade, side: 'SELL', security: { ...trade.security, exchangeMic: 'XNYS' } })).status).toBe(409);
    expect((await post(id, { ...trade, side: 'SELL', occurredAt: '2025-01-03T00:00:00.000Z' })).status).toBe(200);
    expect((await post(id, { ...trade, side: 'SELL', quantity: '1' })).status).toBe(409);
    expect((await post(id, { ...trade, quantity: '1', occurredAt: '2025-01-01T00:00:00.000Z' })).status).toBe(200);
    expect((await post(id, { ...trade, side: 'SELL', quantity: '1' })).status).toBe(200);
    const response = await history(request(`portfolios/${id}/transactions?limit=2`), context(id));
    const page = await response.json(); expect(page.nextOffset).toBe(2);
    const next = await (await history(request(`portfolios/${id}/transactions?limit=2&offset=2`), context(id))).json();
    expect([...page.transactions, ...next.transactions].map(t => t.side)).toEqual(['BUY', 'BUY', 'SELL', 'SELL']);
    expect(next.nextOffset).toBeNull();
  });
  it('serializes conflicting concurrent sales and archive races', async () => {
    const id = await newPortfolio(); await post(id);
    const sales = await Promise.all([post(id, { ...trade, side: 'SELL', quantity: '6' }), post(id, { ...trade, side: 'SELL', quantity: '6' })]);
    expect(sales.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.portfolioTransaction.count({ where: { portfolioId: id, side: 'SELL' } })).toBe(1);
    const race = await Promise.all([archive(request(`portfolios/${id}`, 'DELETE'), context(id)), post(id, { ...trade, side: 'SELL', quantity: '4' })]);
    expect(race[0]!.status).toBe(200); expect([200, 409]).toContain(race[1]!.status);
    expect((await post(id)).status).toBe(409);
  });
  it('rounds amounts exactly at ten places and retains tiny fractional quantities', async () => {
    const id = await newPortfolio();
    const response = await post(id, { ...trade, quantity: '0.0000000001', price: '0.5', fees: '0' });
    expect(response.status).toBe(200);
    expect((await response.json()).transaction).toMatchObject({ quantity: '0.0000000001', amount: '0.0000000001' });
  });
  it('bounds lock retries and permits the same key after contention clears', async () => {
    const id = await newPortfolio(); const key = crypto.randomUUID();
    let release!: () => void; let acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${id} FOR UPDATE`;
      acquired(); await gate;
    }, { timeout: 15000 });
    try {
      await ready;
      const response = await post(id, trade, key);
      expect(response.status).toBe(503);
      expect((await response.json()).error.message).toBe('Portfolio is busy. Retry with the same idempotency key.');
      expect(await db.portfolioTransaction.count({ where: { portfolioId: id } })).toBe(0);
    } finally { release(); await blocker; }
    expect((await post(id, trade, key)).status).toBe(200);
  }, 15000);
});
