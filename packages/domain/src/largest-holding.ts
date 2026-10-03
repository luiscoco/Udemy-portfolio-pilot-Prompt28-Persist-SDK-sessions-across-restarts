import { ExactDecimal } from './decimal.js';
function calculatedMoney(value: string) {
  // Calculated values can exceed the 18-digit limit on individual trade inputs.
  if (!/^(0|[1-9]\d{0,79})(\.\d{1,10})?$/.test(value)) throw new Error('Invalid calculated money');
  const [whole, fraction = ''] = value.split('.');
  return new ExactDecimal(BigInt(whole! + fraction), 10n ** BigInt(fraction.length));
}
/** Rank aggregate security exposure across portfolios with exact decimal money arithmetic. */
export function largestHolding(positions: readonly { securityId: string; symbol: string; marketValue: string | null }[]) {
  if (!positions.length || positions.some(p => p.marketValue === null)) return null;
  const totals = new Map<string, { securityId: string; symbol: string; value: ExactDecimal }>();
  for (const p of positions) {
    const previous = totals.get(p.securityId);
    totals.set(p.securityId, { securityId: p.securityId, symbol: p.symbol, value: (previous?.value ?? new ExactDecimal(0n)).add(calculatedMoney(p.marketValue!)) });
  }
  const ranked = [...totals.values()].sort((a, b) => b.value.compare(a.value) || a.securityId.localeCompare(b.securityId));
  const first = ranked[0]!;
  return { securityId: first.securityId, symbol: first.symbol, marketValue: first.value.fixed(2), tied: ranked.length > 1 && first.value.compare(ranked[1]!.value) === 0 };
}
