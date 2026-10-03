import { ExactDecimal as D } from './decimal.js';

/** Default quote freshness policy shared by valuation and agent tools (15 minutes). */
export const QUOTE_STALE_AFTER_MS = 900000;
export type QuoteStatus = 'fresh' | 'stale' | 'missing' | 'invalid';
export type QuoteLike = Readonly<{ price: string; currency: string; asOf: string }>;

const zero = new D(0n);
function utc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Invalid UTC timestamp');
  return parsed;
}

/**
 * Deterministic quote freshness. A future quote cannot describe the present, so it counts as missing;
 * a non-USD, non-positive or malformed price is invalid and never valued.
 */
export function classifyQuote(quote: QuoteLike | null | undefined, asOf: string, staleAfterMs = QUOTE_STALE_AFTER_MS): { status: QuoteStatus; ageMs: number | null } {
  const now = utc(asOf);
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) throw new Error('Invalid quote freshness policy');
  if (!quote) return { status: 'missing', ageMs: null };
  let time: number;
  try { time = utc(quote.asOf); } catch { return { status: 'invalid', ageMs: null }; }
  if (time > now) return { status: 'missing', ageMs: null };
  let valid = false;
  try { valid = quote.currency === 'USD' && D.parse(quote.price).compare(zero) > 0; } catch { valid = false; }
  const ageMs = now - time;
  if (!valid) return { status: 'invalid', ageMs };
  return { status: ageMs > staleAfterMs ? 'stale' : 'fresh', ageMs };
}

export type PortfolioTotalsInput = Readonly<{
  valuationComplete: boolean; remainingCostBasis: string; soldCostBasis: string; realizedGainLoss: string;
  marketValue: string | null; unrealizedGainLoss: string | null;
}>;

/** Exact cross-portfolio totals. Market value is withheld unless every portfolio is completely valued. */
export function combinePortfolioTotals(portfolios: readonly PortfolioTotalsInput[]) {
  let basis = zero, sold = zero, realized = zero, market = zero;
  let complete = true;
  for (const p of portfolios) {
    basis = basis.add(D.parseSigned(p.remainingCostBasis));
    sold = sold.add(D.parseSigned(p.soldCostBasis));
    realized = realized.add(D.parseSigned(p.realizedGainLoss));
    if (!p.valuationComplete || p.marketValue === null) complete = false;
    else market = market.add(D.parseSigned(p.marketValue));
  }
  return {
    currency: 'USD' as const, portfolioCount: portfolios.length, valuationComplete: complete,
    remainingCostBasis: basis.fixed(2), soldCostBasis: sold.fixed(2), realizedGainLoss: realized.fixed(2),
    marketValue: complete ? market.fixed(2) : null,
    unrealizedGainLoss: complete ? market.subtract(basis).fixed(2) : null
  };
}

export type CoveragePosition = Readonly<{ remainingQuantity: string; quoteStatus: QuoteStatus | 'not_required'; quote: { asOf: string } | null }>;

/** Counts open/closed positions and quote statuses so explanations never need to tally them. */
export function valuationCoverage(positions: readonly CoveragePosition[]) {
  const quoteStatus = { fresh: 0, stale: 0, missing: 0, invalid: 0 };
  let open = 0, closed = 0, oldest: string | null = null;
  for (const p of positions) {
    if (D.parse(p.remainingQuantity).compare(zero) === 0) { closed++; continue; }
    open++;
    if (p.quoteStatus !== 'not_required') quoteStatus[p.quoteStatus]++;
    if (p.quote && (oldest === null || utc(p.quote.asOf) < utc(oldest))) oldest = p.quote.asOf;
  }
  return { openPositions: open, closedPositions: closed, quoteStatus, oldestOpenQuoteAsOf: oldest };
}
