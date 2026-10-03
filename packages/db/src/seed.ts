import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
export const FIXTURE_NOW = new Date('2025-01-15T16:00:00.000Z');
export interface FixtureClock { now(): Date }
export const fixtureClock: FixtureClock = { now: () => new Date(FIXTURE_NOW) };
export const DEMO_USERS = ['demo-alice', 'demo-bob'] as const;
export function assertLocalSeed(environment: NodeJS.ProcessEnv): void {
  const url = new URL(environment.DATABASE_URL ?? '');
  if (!['development', 'test'].includes(environment.NODE_ENV ?? '') || environment.ALLOW_DEMO_SEED !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('Demo seed requires NODE_ENV=development/test, ALLOW_DEMO_SEED=true and a loopback PostgreSQL URL');
  }
}
/** Explicit fixture operation; never called by server startup or migration. No auth credentials/sessions. */
export async function seedDemo(db: PrismaClient, clock: FixtureClock = fixtureClock): Promise<void> {
  const now = clock.now();
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_FIXTURE_CLOCK');
  const timestamps = { createdAt: now, updatedAt: now };
  await db.$transaction(async tx => {
    // Serialize concurrent fixture runs without touching non-fixture rows.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6006)`;
    for (const [id, name] of [['demo-alice', 'Alice Demo'], ['demo-bob', 'Bob Demo']] as const) {
      const data = { name, email: `${id}@example.invalid`, emailVerified: false, ...timestamps };
      await tx.user.upsert({ where: { id }, update: data, create: { id, ...data } });
    }
    for (const [id, ownerId, name] of [['demo-growth', 'demo-alice', 'Growth'], ['demo-income', 'demo-alice', 'Long term'], ['demo-bob-core', 'demo-bob', 'Core']] as const) {
      const data = { ownerId, name, currency: 'USD', ...timestamps };
      await tx.portfolio.upsert({ where: { id }, update: data, create: { id, ...data } });
    }
    for (const [id, symbol, exchangeMic, name] of [['demo-acme-xnas', 'ACME', 'XNAS', 'Acme Synthetic Systems'], ['demo-acme-xnys', 'ACME', 'XNYS', 'Acme Synthetic Industries'], ['demo-nova', 'NOVA', 'XNAS', 'Nova Fictional Labs']] as const) {
      const data = { symbol, exchangeMic, name, currency: 'USD', assetType: 'STOCK', ...timestamps };
      await tx.security.upsert({ where: { id }, update: data, create: { id, ...data } });
      const quote = { securityId: id, provider: 'synthetic-fixture', asOf: now, price: '125.125', currency: 'USD', isSynthetic: true, ...timestamps };
      await tx.quoteSnapshot.upsert({ where: { id: `${id}-quote` }, update: quote, create: { id: `${id}-quote`, ...quote } });
      const article = { provider: 'synthetic-fixture', providerArticleId: id, title: `Synthetic scenario: ${name} announces a fictional lab`, summary: 'Invented teaching fixture. This event did not happen and is not investment evidence.', url: `https://example.invalid/synthetic/${id}`, publishedAt: now, isSynthetic: true, ...timestamps };
      await tx.newsArticle.upsert({ where: { id: `${id}-news` }, update: article, create: { id: `${id}-news`, ...article } });
      const link = { newsArticleId: `${id}-news`, securityId: id };
      await tx.newsArticleSecurity.upsert({ where: { newsArticleId_securityId: link }, update: timestamps, create: { ...link, ...timestamps } });
    }
    const trades = [
      ['demo-t1', 'demo-growth', 'demo-acme-xnas', 'BUY', '10.5', '100.25', '1'],
      ['demo-t2', 'demo-growth', 'demo-acme-xnas', 'SELL', '2.5', '110', '0.5'],
      ['demo-t3', 'demo-income', 'demo-nova', 'BUY', '4', '50', '0'],
      ['demo-t4', 'demo-bob-core', 'demo-acme-xnys', 'BUY', '20', '90', '2'],
      ['demo-t5', 'demo-bob-core', 'demo-acme-xnys', 'SELL', '5', '95', '1']
    ] as const;
    for (const [index, [id, portfolioId, securityId, side, quantity, price, fees]] of trades.entries()) {
      const gross = new Prisma.Decimal(quantity).mul(price);
      const amount = side === 'BUY' ? gross.plus(fees) : gross.minus(fees);
      const data = { portfolioId, securityId, side, quantity, price, fees, amount, occurredAt: new Date(now.getTime() - (trades.length - index) * 86400000), ...timestamps };
      await tx.portfolioTransaction.upsert({ where: { id }, update: data, create: { id, ...data } });
    }
    for (const [ownerId, securityId] of [['demo-alice', 'demo-nova'], ['demo-bob', 'demo-acme-xnys']] as const) {
      const key = { ownerId, securityId };
      await tx.watchlistEntry.upsert({ where: { ownerId_securityId: key }, update: timestamps, create: { id: `${ownerId}-watch`, ...key, ...timestamps } });
    }
  });
}
