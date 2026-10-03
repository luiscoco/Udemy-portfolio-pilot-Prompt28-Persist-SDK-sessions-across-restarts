import type { PrismaClient } from './generated/prisma/client.js';
import { portfolioService, PortfolioError } from './portfolio-service.js';
import { watchlistService } from './watchlist-service.js';
import { portfolioTransactionDtoSchema } from '@portfolio-pilot/contracts';

const ownerBrand: unique symbol = Symbol('authenticated-owner');
export type AuthenticatedOwner = Readonly<{ userId: string; [ownerBrand]: true }>;
const contexts = new WeakSet<object>();
/** Server-only: token must come from the verified HttpOnly session cookie, never request JSON. */
export async function authenticateOwner(db: PrismaClient, token: string, now = new Date()): Promise<AuthenticatedOwner> {
  if (!token || !Number.isFinite(now.getTime())) throw new Error('UNAUTHORIZED');
  const session = await db.session.findUnique({ where: { token } });
  if (!session || session.expiresAt <= now) throw new Error('UNAUTHORIZED');
  const owner: AuthenticatedOwner = Object.freeze({ userId: session.userId, [ownerBrand]: true as const });
  contexts.add(owner);
  return owner;
}
export function requireOwner(owner: AuthenticatedOwner): string {
  if (!owner || !contexts.has(owner)) throw new Error('UNAUTHORIZED');
  return owner.userId;
}

/** Worker capability: audience comes exclusively from a durable, owner-scoped news outbox row. */
export async function ownerForNewsEvent(db: PrismaClient, eventId: string): Promise<AuthenticatedOwner> {
  const event = await db.outboxEvent.findUnique({ where: { id: eventId } });
  if (!event || event.type !== 'news.available' || event.audience !== 'user' || !event.ownerId) throw new Error('UNAUTHORIZED');
  const owner: AuthenticatedOwner = Object.freeze({ userId: event.ownerId, [ownerBrand]: true as const });
  contexts.add(owner);
  return owner;
}
export function ownerRepositories(db: PrismaClient, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  return {
    listPortfolios: () => db.portfolio.findMany({ where: { ownerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    getPortfolio: (id: string) => db.portfolio.findFirst({ where: { id, ownerId } }),
    createPortfolio: (name: string) => {
      const normalized = name.trim();
      if (!normalized || normalized.length > 100) throw new Error('INVALID_NAME');
      // Mutations delegate to the services so every domain change writes its outbox event.
      return portfolioService(db, owner).create({ name: normalized });
    },
    renamePortfolio: (id: string, name: string) => {
      const normalized = name.trim();
      if (!normalized || normalized.length > 100) throw new Error('INVALID_NAME');
      return portfolioService(db, owner).edit(id, { name: normalized }).then(() => ({ count: 1 }));
    },
    deletePortfolio: (id: string) => portfolioService(db, owner).archive(id).then(() => ({ count: 1 })),
    listTransactions: async (portfolioId: string, take = 100) => {
      if (!Number.isInteger(take) || take < 1 || take > 100) throw new Error('INVALID_LIMIT');
      const rows = await db.portfolioTransaction.findMany({
        where: { portfolioId, portfolio: { ownerId } },
        orderBy: [{ occurredAt: 'asc' }, { ledgerOrder: 'asc' }], take,
        include: { security: { select: { symbol: true, exchangeMic: true, currency: true } } }
      });
      return rows.map(row => portfolioTransactionDtoSchema.parse({ ...row, quantity: row.quantity.toFixed(), price: row.price.toFixed(), fees: row.fees.toFixed(), amount: row.amount.toFixed(), occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
    },
    listWatchlist: () => db.watchlistEntry.findMany({ where: { ownerId }, include: { security: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    addWatchlistEntry: (securityId: string) => watchlistService(db, owner).add({ securityId }),
    removeWatchlistEntry: (id: string) => watchlistService(db, owner).remove(id).then(() => ({ count: 1 }), (error: unknown) => {
      if (error instanceof PortfolioError && error.status === 404) return { count: 0 };
      throw error;
    }),
    listQuotes: async () => {
      const rows = await db.quoteSnapshot.findMany({ where: { security: { OR: [{ watchlist: { some: { ownerId } } }, { transactions: { some: { portfolio: { ownerId } } } }] } }, orderBy: [{ asOf: 'desc' }, { id: 'asc' }], take: 100 });
      return rows.map(row => ({ ...row, price: row.price.toFixed(), asOf: row.asOf.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
    },
    listNews: () => db.newsArticle.findMany({ where: { securities: { some: { security: { OR: [{ watchlist: { some: { ownerId } } }, { transactions: { some: { portfolio: { ownerId } } } }] } } } }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: 100 })
  };
}


/** Worker-only capability: trusted identity comes from a currently leased durable job. */
export async function ownerForAgentRun(db: PrismaClient, fence: import('./run-lease.js').RunFence): Promise<AuthenticatedOwner> {
 const row = await db.agentRun.findFirst({ where: { id: fence.runId, attempt: fence.attempt, leaseOwner: fence.owner }, include: { conversation: true } });
 if (!row) throw new Error('UNAUTHORIZED');
 const valid = await db.$queryRaw<{ id: string }[]>`SELECT r."id" FROM "AgentRun" r JOIN "Conversation" c ON c."id"=r."conversationId" WHERE r."id"=${fence.runId}
 AND r."leaseOwner"=${fence.owner} AND r."attempt"=${fence.attempt} AND r."leaseUntil">clock_timestamp() AND r."status" IN ('running','waiting_for_approval')
 AND c."leaseOwner"=${fence.owner} AND c."leaseRunId"=r."id" AND c."leaseUntil">clock_timestamp()`;
 if (!valid.length) throw new Error('UNAUTHORIZED');
 const owner: AuthenticatedOwner = Object.freeze({ userId: row.conversation.ownerId, [ownerBrand]: true as const });
 contexts.add(owner); return owner;
}

export async function authenticateRecoveryOwner(db: PrismaClient, runId: string): Promise<AuthenticatedOwner> {
 const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { conversation: true } });
 const owner: AuthenticatedOwner = Object.freeze({ userId: run.conversation.ownerId, [ownerBrand]: true as const });
 contexts.add(owner); return owner;
}
