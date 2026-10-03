import { securityOptionSchema, watchlistEntrySchema, watchlistWriteSchema } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';
import { appendEvent } from './outbox.js';
import type { Prisma } from './generated/prisma/client.js';

export function watchlistService(db: PrismaClient, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  const include = { security: true } as const;
  const dto = (row: { id: string; security: unknown; createdAt: Date; updatedAt: Date }) => watchlistEntrySchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  async function security(input: unknown) {
    const { securityId } = watchlistWriteSchema.parse(input);
    if (!await db.security.findFirst({ where: { id: securityId, currency: 'USD', assetType: 'STOCK' } })) throw new PortfolioError(400, 'Unknown USD stock identity.');
    return securityId;
  }
  const changed = (tx: Prisma.TransactionClient, entryId: string, change: 'added' | 'changed' | 'removed', securityId: string | null) =>
    appendEvent(tx, { type: 'watchlist.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'watchlist_entry', entityId: entryId, portfolioId: null, payload: { change, securityId } });
  return {
    securities: async () => (await db.security.findMany({ where: { currency: 'USD', assetType: 'STOCK' }, orderBy: [{ symbol: 'asc' }, { exchangeMic: 'asc' }] })).map(row => securityOptionSchema.parse(row)),
    list: async () => (await db.watchlistEntry.findMany({ where: { ownerId }, include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(dto),
    add: async (input: unknown) => {
      const securityId = await security(input);
      return db.$transaction(async tx => {
        // ON CONFLICT DO NOTHING keeps concurrent adds idempotent; only a real insert emits an event.
        const inserted = (await tx.watchlistEntry.createMany({ data: [{ ownerId, securityId }], skipDuplicates: true })).count;
        const row = await tx.watchlistEntry.findUniqueOrThrow({ where: { ownerId_securityId: { ownerId, securityId } }, include });
        if (inserted) await changed(tx, row.id, 'added', securityId);
        return dto(row);
      });
    },
    edit: async (id: string, input: unknown) => {
      const securityId = await security(input);
      return db.$transaction(async tx => {
        const result = await tx.watchlistEntry.updateMany({ where: { id, ownerId }, data: { securityId } });
        if (!result.count) throw new PortfolioError(404, 'Resource not found.');
        const row = await tx.watchlistEntry.findFirst({ where: { id, ownerId }, include });
        if (!row) throw new PortfolioError(404, 'Resource not found.');
        await changed(tx, id, 'changed', securityId);
        return dto(row);
      });
    },
    remove: async (id: string) => {
      return db.$transaction(async tx => {
        const row = await tx.watchlistEntry.findFirst({ where: { id, ownerId }, select: { securityId: true } });
        if (!row || !(await tx.watchlistEntry.deleteMany({ where: { id, ownerId } })).count) throw new PortfolioError(404, 'Resource not found.');
        await changed(tx, id, 'removed', row.securityId);
        return { removed: true as const };
      });
    }
  };
}
