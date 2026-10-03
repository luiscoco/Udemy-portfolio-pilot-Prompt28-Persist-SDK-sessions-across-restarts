import { ExactDecimal as D } from './decimal.js';
import type { QuoteStatus } from './portfolio-facts.js';

export type ExposureBasis = 'market_value' | 'cost_basis';
export type ExposurePosition = Readonly<{
  securityId: string; symbol: string; exchangeMic: string;
  remainingQuantity: string; remainingCostBasis: string; marketValue: string | null; quoteStatus: QuoteStatus | 'not_required';
}>;
export type ExposurePortfolio = Readonly<{ portfolioId: string; name: string; positions: readonly ExposurePosition[] }>;
export type ExposureHolding = {
  securityId: string; symbol: string; exchangeMic: string; portfolioId: string; portfolioName: string;
  quantity: string; value: string; valueBasis: ExposureBasis; weight: string | null; quoteStatus: QuoteStatus | 'not_required';
};
export type ArticleExposureResult = {
  relevance: 'held' | 'watchlisted' | 'none'; basis: ExposureBasis | null;
  affectedValue: string; totalValue: string; weight: string | null; largestHoldingWeight: string | null;
  holdings: ExposureHolding[];
  portfolios: { portfolioId: string; name: string; affectedValue: string; totalValue: string; weight: string | null }[];
  watchlistedSecurityIds: string[]; concentrationThreshold: string;
};

/** A single affected holding at or above this fraction of its portfolio triggers a concentration review. */
export const EXPOSURE_POLICY = { concentrationThreshold: '0.2', weightPlaces: 10, moneyPlaces: 2 } as const;

const zero = new D(0n);
/** Calculated values (sums, cost bases) can exceed the 18-digit limit on individual trade inputs. */
function amount(value: string): D {
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  if (!/^(0|[1-9]\d{0,79})(\.\d{1,10})?$/.test(digits)) throw new Error('Invalid calculated amount');
  const [whole, fraction = ''] = digits.split('.');
  return new D((negative ? -1n : 1n) * BigInt(whole! + fraction), 10n ** BigInt(fraction.length));
}
const ratio = (part: D, total: D) => total.compare(zero) > 0 ? part.divide(total).fixed(EXPOSURE_POLICY.weightPlaces) : null;

/**
 * Deterministic exposure of one owner's current holdings to the securities an article is linked to.
 *
 * Basis: market value when EVERY open position (in every supplied portfolio) has a fresh-quote market
 * value; otherwise cost basis for all of them, so weights never mix bases. Weights are exact rational
 * fractions rounded half-up only at the output boundary. Closed positions are ignored.
 */
export function articleExposure(input: {
  affectedSecurityIds: readonly string[]; portfolios: readonly ExposurePortfolio[]; watchlistSecurityIds: readonly string[]; concentrationThreshold?: string;
}): ArticleExposureResult {
  const threshold = input.concentrationThreshold ?? EXPOSURE_POLICY.concentrationThreshold;
  const thresholdValue = amount(threshold);
  if (thresholdValue.compare(zero) <= 0 || thresholdValue.compare(new D(1n)) > 0) throw new Error('Invalid concentration threshold');
  const affected = new Set(input.affectedSecurityIds);
  const open = input.portfolios.map(p => ({ ...p, positions: p.positions.filter(position => amount(position.remainingQuantity).compare(zero) > 0) }))
    .sort((a, b) => a.portfolioId.localeCompare(b.portfolioId));
  const all = open.flatMap(p => p.positions);
  const basis: ExposureBasis | null = !all.length ? null : all.every(p => p.marketValue !== null && p.quoteStatus === 'fresh') ? 'market_value' : 'cost_basis';
  const valueOf = (p: ExposurePosition) => amount(basis === 'market_value' ? p.marketValue! : p.remainingCostBasis);

  let affectedTotal = zero, grandTotal = zero;
  const holdings: ExposureHolding[] = [];
  const portfolios: ArticleExposureResult['portfolios'] = [];
  for (const portfolio of open) {
    const total = portfolio.positions.reduce((sum, p) => sum.add(valueOf(p)), zero);
    let affectedValue = zero;
    for (const p of [...portfolio.positions].sort((a, b) => a.securityId.localeCompare(b.securityId))) {
      if (!affected.has(p.securityId)) continue;
      const value = valueOf(p);
      affectedValue = affectedValue.add(value);
      holdings.push({ securityId: p.securityId, symbol: p.symbol, exchangeMic: p.exchangeMic, portfolioId: portfolio.portfolioId, portfolioName: portfolio.name,
        quantity: p.remainingQuantity, value: value.fixed(EXPOSURE_POLICY.moneyPlaces), valueBasis: basis!, weight: ratio(value, total), quoteStatus: p.quoteStatus });
    }
    grandTotal = grandTotal.add(total); affectedTotal = affectedTotal.add(affectedValue);
    if (affectedValue.compare(zero) > 0 || portfolio.positions.some(p => affected.has(p.securityId))) {
      portfolios.push({ portfolioId: portfolio.portfolioId, name: portfolio.name, affectedValue: affectedValue.fixed(2), totalValue: total.fixed(2), weight: ratio(affectedValue, total) });
    }
  }
  const held = new Set(holdings.map(h => h.securityId));
  const watchlisted = [...new Set(input.watchlistSecurityIds)].filter(id => affected.has(id)).sort();
  const weights = holdings.flatMap(h => h.weight === null ? [] : [amount(h.weight)]);
  const largest = weights.length ? weights.reduce((max, w) => w.compare(max) > 0 ? w : max).fixed(EXPOSURE_POLICY.weightPlaces) : null;
  return {
    relevance: held.size ? 'held' : watchlisted.length ? 'watchlisted' : 'none', basis,
    affectedValue: affectedTotal.fixed(2), totalValue: grandTotal.fixed(2), weight: ratio(affectedTotal, grandTotal), largestHoldingWeight: largest,
    holdings, portfolios, watchlistedSecurityIds: watchlisted, concentrationThreshold: threshold
  };
}

/** True when `weight` (a decimal fraction string) is at or above `threshold`. */
export function atOrAbove(weight: string | null, threshold: string): boolean {
  return weight !== null && amount(weight).compare(amount(threshold)) >= 0;
}
