import { createHash } from 'node:crypto';
import { idempotencyKeySchema, portfolioCreateSchema, portfolioEditSchema, transactionCreateSchema, transactionPageSchema, portfolioTransactionDtoSchema } from '@portfolio-pilot/contracts';
import { quantityUnits, validateLongOnlyLedger } from '@portfolio-pilot/domain';
import type { PrismaClient, Prisma } from './generated/prisma/client.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { appendEvent } from './outbox.js';

export class PortfolioError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 429 | 503, message: string) { super(message); }
}
const missing = () => new PortfolioError(404, 'Resource not found.');
const include = { security: { select: { symbol: true, exchangeMic: true, currency: true } } } as const;
type Trade = Prisma.PortfolioTransactionGetPayload<{ include: typeof include }>;
function dto(row: Trade) {
  return portfolioTransactionDtoSchema.parse({ ...row, quantity: row.quantity.toFixed(), price: row.price.toFixed(), fees: row.fees.toFixed(), amount: row.amount.toFixed(), occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}
function fixed(units: bigint): string {
  return `${units / 10000000000n}.${(units % 10000000000n).toString().padStart(10, '0')}`;
}
export function portfolioService(db: PrismaClient, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  async function locked<T>(id: string, action: (tx: Prisma.TransactionClient, portfolio: Prisma.PortfolioGetPayload<object>) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
          const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Portfolio" WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
          if (!rows.length) throw missing();
          const portfolio = await tx.portfolio.findFirst({ where: { id, ownerId } });
          if (!portfolio) throw missing();
          return action(tx, portfolio);
        }, { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 10000 });
      } catch (error) {
        const code = (error as { code?: string }).code;
        const meta = (error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }).meta;
        const sqlState = meta?.driverAdapterError?.cause?.originalCode ?? meta?.code;
        if (!(code === 'P2034' || (code === 'P2010' && ['55P03', '40P01', '40001'].includes(sqlState ?? '')))) throw error;
        if (attempt === 2) throw new PortfolioError(503, 'Portfolio is busy. Retry with the same idempotency key.');
        await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
      }
    }
  }
  // Same transaction client as the change: the event commits or rolls back with it.
  const changed = (tx: Prisma.TransactionClient, portfolioId: string, change: 'created' | 'renamed' | 'archived' | 'transaction.recorded', transactionId: string | null = null) =>
    appendEvent(tx, { type: 'portfolio.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'portfolio', entityId: portfolioId, portfolioId, payload: { change, transactionId } });
  return {
    list: () => db.portfolio.findMany({ where: { ownerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    get: async (id: string) => {
      const row = await db.portfolio.findFirst({ where: { id, ownerId } });
      if (!row) throw missing();
      return row;
    },
    create: async (input: unknown) => {
      const data = { ...portfolioCreateSchema.parse(input), ownerId };
      return db.$transaction(async tx => {
        const portfolio = await tx.portfolio.create({ data });
        await changed(tx, portfolio.id, 'created');
        return portfolio;
      });
    },
    edit: (id: string, input: unknown) => {
      const data = portfolioEditSchema.parse(input);
      return locked(id, async (tx, portfolio) => {
        if (portfolio.archivedAt) throw new PortfolioError(409, 'Archived portfolios are read-only.');
        const updated = await tx.portfolio.update({ where: { id }, data });
        await changed(tx, id, 'renamed');
        return updated;
      });
    },
    archive: (id: string) => locked(id, async (tx, portfolio) => {
      if (portfolio.archivedAt) return portfolio;
      const archived = await tx.portfolio.update({ where: { id }, data: { archivedAt: new Date() } });
      await changed(tx, id, 'archived');
      return archived;
    }),
    transactions: async (id: string, input: unknown) => {
      const { limit, offset } = transactionPageSchema.parse(input);
      if (!await db.portfolio.findFirst({ where: { id, ownerId } })) throw missing();
      const rows = await db.portfolioTransaction.findMany({ where: { portfolioId: id, portfolio: { ownerId } }, include, orderBy: [{ occurredAt: 'asc' }, { ledgerOrder: 'asc' }], skip: offset, take: limit + 1 });
      return { transactions: rows.slice(0, limit).map(dto), nextOffset: rows.length > limit ? offset + limit : null };
    },
    record: (id: string, input: unknown, keyInput: unknown) => {
      const data = transactionCreateSchema.parse(input);
      const key = idempotencyKeySchema.parse(keyInput);
      const occurredAt = new Date(data.occurredAt);
      if (occurredAt.getTime() > Date.now()) throw new PortfolioError(400, 'Future trades are not allowed.');
      const normalized = { ...data, quantity: fixed(quantityUnits(data.quantity)), price: fixed(quantityUnits(data.price)), fees: fixed(quantityUnits(data.fees)) };
      const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      return locked(id, async (tx, portfolio) => {
        const previous = await tx.portfolioTransaction.findUnique({ where: { portfolioId_idempotencyKey: { portfolioId: id, idempotencyKey: key } }, include });
        if (previous) {
          if (previous.requestFingerprint !== fingerprint) throw new PortfolioError(409, 'Idempotency key already used for a different trade.');
          return { transaction: dto(previous), replayed: true };
        }
        if (portfolio.archivedAt) throw new PortfolioError(409, 'Archived portfolios are read-only.');
        const security = await tx.security.findUnique({ where: { exchangeMic_symbol: { exchangeMic: data.security.exchangeMic, symbol: data.security.symbol } } });
        if (!security || security.currency !== data.security.currency || security.assetType !== 'STOCK') throw new PortfolioError(400, 'Unknown USD stock identity.');
        const gross = quantityUnits(data.quantity) * quantityUnits(data.price);
        const fee = quantityUnits(data.fees) * 10000000000n;
        const net = data.side === 'BUY' ? gross + fee : gross - fee;
        if (net < 0n) throw new PortfolioError(400, 'Sell fees exceed proceeds.');
        const amountUnits = (net + 5000000000n) / 10000000000n;
        if (amountUnits >= 10n ** 38n) throw new PortfolioError(400, 'Trade amount exceeds storage precision.');
        const row = await tx.portfolioTransaction.create({ data: { portfolioId: id, securityId: security.id, side: data.side, quantity: data.quantity, price: data.price, fees: data.fees, amount: fixed(amountUnits), occurredAt, idempotencyKey: key, requestFingerprint: fingerprint }, include });
        // Written before ledger validation on purpose: an oversell rolls back the trade AND its event.
        await changed(tx, id, 'transaction.recorded', row.id);
        const ledger = await tx.portfolioTransaction.findMany({ where: { portfolioId: id }, orderBy: [{ occurredAt: 'asc' }, { ledgerOrder: 'asc' }] });
        if (!validateLongOnlyLedger(ledger.map(trade => ({ ...trade, quantity: trade.quantity.toFixed() })))) throw new PortfolioError(409, 'Trade would oversell the chronological ledger.');
        return { transaction: dto(row), replayed: false };
      });
    }
  };
}
