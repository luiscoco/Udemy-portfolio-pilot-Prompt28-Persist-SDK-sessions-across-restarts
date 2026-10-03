import { ExactDecimal as D } from './decimal.js';
import { classifyQuote, QUOTE_STALE_AFTER_MS } from './portfolio-facts.js';

export type ValuationTrade = Readonly<{
  securityId: string; side: 'BUY' | 'SELL'; quantity: string; price: string; fees: string;
  occurredAt: string; ledgerOrder: bigint;
}>;
export type ValuationQuote = Readonly<{
  securityId: string; price: string; currency: string; asOf: string; provider: string; isSynthetic: boolean;
}>;
const zero = new D(0n);
function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Invalid UTC timestamp');
  return parsed;
}
/** Pure current snapshot; trades are sorted by UTC time then unique database ledger order. */
export function calculatePortfolioSummary(trades: readonly ValuationTrade[], quotes: readonly ValuationQuote[], asOf: string, staleAfterMs = QUOTE_STALE_AFTER_MS) {
  const now = timestamp(asOf);
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) throw new Error('Invalid quote freshness policy');
  const positions = new Map<string, { quantity: D; basis: D; realized: D; soldBasis: D }>();
  const orders = new Set<bigint>();
  const rows = trades.map(trade => ({ trade, time: timestamp(trade.occurredAt) })).sort((a, b) => a.time - b.time || (a.trade.ledgerOrder < b.trade.ledgerOrder ? -1 : a.trade.ledgerOrder > b.trade.ledgerOrder ? 1 : 0));
  for (const { trade, time } of rows) {
    if (!trade.securityId || orders.has(trade.ledgerOrder) || trade.ledgerOrder <= 0n || time > now) throw new Error('Invalid chronological ledger');
    orders.add(trade.ledgerOrder);
    const quantity = D.parse(trade.quantity), price = D.parse(trade.price), fees = D.parse(trade.fees);
    if (quantity.compare(zero) <= 0 || price.compare(zero) <= 0) throw new Error('Invalid trade');
    const position = positions.get(trade.securityId) ?? { quantity: zero, basis: zero, realized: zero, soldBasis: zero };
    const gross = quantity.multiply(price);
    if (trade.side === 'BUY') {
      position.quantity = position.quantity.add(quantity);
      position.basis = position.basis.add(gross).add(fees);
    } else if (trade.side === 'SELL') {
      if (quantity.compare(position.quantity) > 0 || fees.compare(gross) > 0) throw new Error('Invalid chronological inventory or sell fees');
      const sold = position.basis.multiply(quantity).divide(position.quantity);
      position.soldBasis = position.soldBasis.add(sold);
      position.realized = position.realized.add(gross.subtract(fees).subtract(sold));
      position.basis = position.basis.subtract(sold);
      position.quantity = position.quantity.subtract(quantity);
    } else throw new Error('Invalid side');
    positions.set(trade.securityId, position);
  }
  const latest = new Map<string, ValuationQuote>();
  for (const quote of quotes) {
    const time = timestamp(quote.asOf);
    if (time > now) continue; // A future quote cannot value a current snapshot.
    if (!latest.has(quote.securityId) || time > timestamp(latest.get(quote.securityId)!.asOf)) latest.set(quote.securityId, quote);
  }
  let totalBasis = zero, totalRealized = zero, totalSold = zero, totalMarket = zero;
  let complete = true;
  const calculated = [...positions].sort(([a], [b]) => a.localeCompare(b)).map(([securityId, position]) => {
    const closed = position.quantity.compare(zero) === 0;
    const quote = latest.get(securityId);
    const quoteStatus = closed ? 'not_required' : classifyQuote(quote, asOf, staleAfterMs).status;
    const market = closed ? zero : quoteStatus === 'fresh' ? position.quantity.multiply(D.parse(quote!.price)) : null;
    if (market === null) complete = false; else totalMarket = totalMarket.add(market);
    totalBasis = totalBasis.add(position.basis); totalRealized = totalRealized.add(position.realized); totalSold = totalSold.add(position.soldBasis);
    return { securityId, position, quote, quoteStatus, market };
  });
  return {
    asOf, currency: 'USD' as const, staleAfterMs, valuationComplete: complete,
    remainingCostBasis: totalBasis.fixed(2), soldCostBasis: totalSold.fixed(2), realizedGainLoss: totalRealized.fixed(2),
    marketValue: complete ? totalMarket.fixed(2) : null,
    unrealizedGainLoss: complete ? totalMarket.subtract(totalBasis).fixed(2) : null,
    positions: calculated.map(({ securityId, position, quote, quoteStatus, market }) => ({
      securityId, remainingQuantity: position.quantity.fixed(10),
      weightedAverageAcquisitionCost: position.quantity.compare(zero) ? position.basis.divide(position.quantity).fixed(10) : null,
      remainingCostBasis: position.basis.fixed(2), soldCostBasis: position.soldBasis.fixed(2), realizedGainLoss: position.realized.fixed(2),
      marketValue: market?.fixed(2) ?? null, unrealizedGainLoss: market?.subtract(position.basis).fixed(2) ?? null,
      allocationWeight: complete && totalMarket.compare(zero) > 0 ? market!.divide(totalMarket).fixed(10) : null,
      quoteStatus, quote: quote ? { ...quote } : null
    }))
  };
}
