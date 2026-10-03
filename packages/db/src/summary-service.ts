import { calculatePortfolioSummary } from '@portfolio-pilot/domain';
import { portfolioSummarySchema } from '@portfolio-pilot/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';

export function summaryService(db: PrismaClient, owner: AuthenticatedOwner) {
  const ownerId = requireOwner(owner);
  return {
    get: (id: string, now = new Date()) => db.$transaction(async tx => {
      const portfolio = await tx.portfolio.findFirst({ where: { id, ownerId } });
      if (!portfolio) throw new PortfolioError(404, 'Resource not found.');
      const rows = await tx.portfolioTransaction.findMany({
        where: { portfolioId: id, portfolio: { ownerId } },
        orderBy: [{ occurredAt: 'asc' }, { ledgerOrder: 'asc' }],
        include: { security: { select: { symbol: true, exchangeMic: true, currency: true } } }
      });
      const securityIds = [...new Set(rows.map(row => row.securityId))];
      const quotes = await tx.quoteSnapshot.findMany({
        where: { securityId: { in: securityIds }, asOf: { lte: now }, security: { transactions: { some: { portfolioId: id, portfolio: { ownerId } } } } },
        orderBy: [{ asOf: 'desc' }, { id: 'asc' }], distinct: ['securityId']
      });
      const summary = calculatePortfolioSummary(rows.map(row => ({
        securityId: row.securityId, side: row.side, ledgerOrder: row.ledgerOrder,
        quantity: row.quantity.toFixed(), price: row.price.toFixed(), fees: row.fees.toFixed(), occurredAt: row.occurredAt.toISOString()
      })), quotes.map(quote => ({
        securityId: quote.securityId, price: quote.price.toFixed(), currency: quote.currency, asOf: quote.asOf.toISOString(), provider: quote.provider, isSynthetic: quote.isSynthetic
      })), now.toISOString());
      return portfolioSummarySchema.parse({ ...summary, portfolioId: id, name: portfolio.name,
        positions: summary.positions.map(position => ({ ...position, security: rows.find(row => row.securityId === position.securityId)!.security }))
      });
    }, { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 10000 })
  };
}
