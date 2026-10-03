import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedDemo, FIXTURE_NOW, assertLocalSeed } from '../dist/seed.js';
import { authenticateOwner, ownerRepositories } from '../dist/repositories.js';

// Deliberately refuse an arbitrary database: this script expects an empty disposable database.
const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.ok(['/portfolio_m06_verify', '/portfolio_m06_verify_final'].includes(url.pathname));
assert.equal(process.env.NODE_ENV, 'test');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const tokenA = randomBytes(32).toString('hex');
const tokenB = randomBytes(32).toString('hex');
const tables = ['user', 'session', 'account', 'verification', 'portfolio', 'security', 'portfolioTransaction', 'watchlistEntry', 'quoteSnapshot', 'newsArticle', 'newsArticleSecurity'];
async function snapshot() {
  return JSON.stringify(await Promise.all(tables.map(async name => {
    const rows = await db[name].findMany();
    return rows.map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).sort();
  })));
}
try {
  for (const table of tables) assert.equal(await db[table].count(), 0, `Expected fresh database: ${table}`);
  assert.throws(() => assertLocalSeed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true', DATABASE_URL: url.toString() }));
  assert.throws(() => assertLocalSeed({ NODE_ENV: 'test', DATABASE_URL: url.toString() }));
  assert.throws(() => assertLocalSeed({ NODE_ENV: 'test', ALLOW_DEMO_SEED: 'true', DATABASE_URL: 'postgresql://u:p@remote/db' }));
  await seedDemo(db);
  const first = await snapshot();
  await seedDemo(db);
  assert.equal(await snapshot(), first, 'Seeding twice must preserve every row and timestamp');
  await Promise.all([seedDemo(db), seedDemo(db)]);
  assert.equal(await snapshot(), first, 'Concurrent seeds must be idempotent');
  assert.equal(await db.user.count(), 2);
  assert.equal(await db.portfolio.count(), 3);
  assert.equal(await db.portfolioTransaction.count(), 5);
  assert.equal(await db.security.count({ where: { symbol: 'ACME' } }), 2);
  assert.equal(await db.session.count(), 0, 'Seed must not create login credentials');
  assert.equal(await db.quoteSnapshot.count({ where: { isSynthetic: true, asOf: FIXTURE_NOW } }), 3);
  assert.equal(await db.newsArticle.count({ where: { isSynthetic: true } }), 3);
  console.log('PASS: fresh migration, sequential/concurrent seed idempotency, fixture clock, synthetic labels and exchange-aware identity');

  for (const [id, userId, token] of [['verify-a', 'demo-alice', tokenA], ['verify-b', 'demo-bob', tokenB]]) {
    await db.session.create({ data: { id, userId, token, expiresAt: new Date('2025-01-16T16:00:00Z') } });
  }
  await assert.rejects(authenticateOwner(db, 'invalid', FIXTURE_NOW), /UNAUTHORIZED/);
  await assert.rejects(authenticateOwner(db, tokenA, new Date('2025-01-16T16:00:00Z')), /UNAUTHORIZED/);
  assert.throws(() => ownerRepositories(db, { userId: 'demo-alice' }), /UNAUTHORIZED/);
  const alice = ownerRepositories(db, await authenticateOwner(db, tokenA, FIXTURE_NOW));
  const bob = ownerRepositories(db, await authenticateOwner(db, tokenB, FIXTURE_NOW));
  assert.equal((await alice.listPortfolios()).length, 2);
  assert.equal((await bob.listPortfolios()).length, 1);
  assert.equal(await alice.getPortfolio('demo-bob-core'), null);
  assert.deepEqual(await alice.listTransactions('demo-bob-core'), []);
  await assert.rejects(alice.renamePortfolio('demo-bob-core', 'Intrusion'), /Resource not found/);
  await assert.rejects(alice.deletePortfolio('demo-bob-core'), /Resource not found/);
  assert.equal((await alice.removeWatchlistEntry('demo-bob-watch')).count, 0);
  const trades = await alice.listTransactions('demo-growth');
  assert.equal(trades[0].amount, '1053.625');
  assert.equal(trades[1].amount, '274.5');
  for (const row of trades) for (const field of ['quantity', 'price', 'fees', 'amount']) assert.equal(typeof row[field], 'string');
  const fractional = await db.portfolioTransaction.create({ data: { portfolioId: 'demo-growth', securityId: 'demo-acme-xnas', side: 'BUY', quantity: '0.0000000001', price: '1', fees: '0', amount: '0.0000000001', occurredAt: FIXTURE_NOW } });
  const fractionalDto = (await alice.listTransactions('demo-growth')).find(row => row.id === fractional.id);
  assert.equal(fractionalDto.quantity, '0.0000000001');
  assert.equal(fractionalDto.amount, '0.0000000001');
  await db.portfolioTransaction.delete({ where: { id: fractional.id } });
  const quotes = await alice.listQuotes();
  assert.equal(quotes.length, 2);
  assert.ok(quotes.every(row => row.securityId !== 'demo-acme-xnys' && typeof row.price === 'string'));
  assert.equal((await alice.listNews()).length, 2);
  assert.equal((await bob.listNews()).length, 1);
  await alice.addWatchlistEntry('demo-acme-xnas');
  await alice.addWatchlistEntry('demo-acme-xnas');
  assert.equal((await alice.listWatchlist()).length, 2);
  const disposable = await alice.createPortfolio('Verification disposable');
  assert.equal(disposable.ownerId, 'demo-alice');
  await alice.deletePortfolio(disposable.id);
  assert.ok((await alice.getPortfolio(disposable.id)).archivedAt, 'Delete archives without erasing the portfolio');
  await db.session.delete({ where: { id: 'verify-a' } });
  await assert.rejects(authenticateOwner(db, tokenA, FIXTURE_NOW), /UNAUTHORIZED/);
  console.log('PASS: anonymous/forged/expired/revoked contexts; cross-owner reads and writes; decimal string DTOs');

  const original = await db.portfolioTransaction.findUniqueOrThrow({ where: { id: 'demo-t1' } });
  for (const data of [{ quantity: '-1' }, { price: '-1' }, { fees: '-1' }, { amount: '123' }]) {
    await assert.rejects(db.portfolioTransaction.update({ where: { id: original.id }, data }));
  }
  await assert.rejects(db.security.update({ where: { id: 'demo-nova' }, data: { currency: 'EUR' } }));
  await assert.rejects(db.security.delete({ where: { id: 'demo-acme-xnas' } }));
  await assert.rejects(db.security.create({ data: { symbol: 'ACME', exchangeMic: 'XNAS', name: 'Duplicate' } }));
  await assert.rejects(db.portfolio.create({ data: { ownerId: 'demo-alice', name: 'Growth' } }));
  await db.user.delete({ where: { id: 'demo-bob' } });
  assert.equal(await db.session.count({ where: { userId: 'demo-bob' } }), 0);
  assert.equal(await db.portfolioTransaction.count({ where: { portfolioId: 'demo-bob-core' } }), 0);
  assert.equal(await db.watchlistEntry.count({ where: { ownerId: 'demo-bob' } }), 0);
  assert.equal(await db.security.count(), 3);
  console.log('PASS: SQL numeric/USD/check constraints, unique identities, restrictive security deletion and owner cascades');
} finally {
  await db.$disconnect();
}

