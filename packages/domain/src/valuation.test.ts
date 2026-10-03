import { describe, expect, it } from 'vitest';
import { calculatePortfolioSummary as summary, type ValuationTrade } from './valuation.js';
const now = '2026-10-02T12:00:00.000Z';
function trade(side: 'BUY' | 'SELL', quantity: string, price: string, fees: string, order: number, securityId = 'a'): ValuationTrade {
  return { securityId, side, quantity, price, fees, ledgerOrder: BigInt(order), occurredAt: `2025-01-0${order}T00:00:00.000Z` };
}
const buys = [trade('BUY', '10', '100', '2', 1), trade('BUY', '5', '120', '1', 2)];
const reference = [...buys, trade('SELL', '6', '130', '3', 3)];
const quote = { securityId: 'a', price: '125', currency: 'USD', asOf: now, provider: 'test', isSynthetic: true };
describe('exact weighted average valuation', () => {
  it('matches every reference amount and preserves unit cost after a partial sale', () => {
    const before = summary(buys, [quote], now).positions[0]!;
    const result = summary(reference, [quote], now);
    expect(before.remainingCostBasis).toBe('1603.00'); expect(before.remainingQuantity).toBe('15.0000000000');
    expect(result.positions[0]).toMatchObject({ remainingQuantity: '9.0000000000', soldCostBasis: '641.20', remainingCostBasis: '961.80', realizedGainLoss: '135.80', marketValue: '1125.00', unrealizedGainLoss: '163.20', allocationWeight: '1.0000000000', weightedAverageAcquisitionCost: before.weightedAverageAcquisitionCost });
    expect(result).toMatchObject({ marketValue: '1125.00', unrealizedGainLoss: '163.20', realizedGainLoss: '135.80' });
    expect(summary([...reference].reverse(), [quote], now)).toEqual(result);
  });
  it('fully liquidates with no residual basis and no quote requirement, then restarts acquisition cost', () => {
    const rows = [...reference, trade('SELL', '9', '90', '2', 4)];
    expect(summary(rows, [], now)).toMatchObject({ valuationComplete: true, marketValue: '0.00', remainingCostBasis: '0.00', soldCostBasis: '1603.00', realizedGainLoss: '-18.00' });
    expect(summary(rows, [], now).positions[0]).toMatchObject({ weightedAverageAcquisitionCost: null, quoteStatus: 'not_required', allocationWeight: null });
    expect(summary([...rows, trade('BUY', '1', '50', '1', 5)], [quote], now).positions[0]!.weightedAverageAcquisitionCost).toBe('51.0000000000');
  });
  it('keeps fractional shares and repeating costs exact across sales', () => {
    const rows = [trade('BUY', '0.3', '10', '0.01', 1), trade('SELL', '0.1', '11', '0', 2), trade('SELL', '0.1', '11', '0', 3)];
    expect(summary(rows, [quote], now).positions[0]).toMatchObject({ remainingQuantity: '0.1000000000', remainingCostBasis: '1.00', soldCostBasis: '2.01', realizedGainLoss: '0.19', weightedAverageAcquisitionCost: '10.0333333333' });
    expect(summary([...rows, trade('SELL', '0.1', '11', '0', 4)], [], now).remainingCostBasis).toBe('0.00');
    expect(summary([trade('BUY', '0.0000000001', '0.0000000001', '0', 1)], [quote], now).positions[0]!.remainingQuantity).toBe('0.0000000001');
  });
  it('does not value missing, stale, future, zero or non-USD quotes at zero', () => {
    for (const [quotes, status] of [[[], 'missing'], [[{ ...quote, asOf: '2026-10-02T11:44:59.999Z' }], 'stale'], [[{ ...quote, asOf: '2026-10-03T12:00:00.000Z' }], 'missing'], [[{ ...quote, price: '0' }], 'invalid'], [[{ ...quote, currency: 'EUR' }], 'invalid'], [[{ ...quote, price: 'bad' }], 'invalid']] as const) {
      const result = summary(reference, quotes, now);
      expect(result).toMatchObject({ valuationComplete: false, marketValue: null, unrealizedGainLoss: null, realizedGainLoss: '135.80' });
      expect(result.positions[0]).toMatchObject({ quoteStatus: status, marketValue: null, allocationWeight: null });
    }
    expect(summary(reference, [{ ...quote, asOf: '2026-10-02T11:45:00.000Z' }], now).valuationComplete).toBe(true);
  });
  it('weights exact market values only when all open holdings are valued', () => {
    const rows = [trade('BUY', '1', '1', '0', 1), trade('BUY', '3', '1', '0', 2, 'b')];
    const quotes = [{ ...quote, price: '1' }, { ...quote, securityId: 'b', price: '1' }];
    expect(summary(rows, quotes, now).positions.map(p => p.allocationWeight)).toEqual(['0.2500000000', '0.7500000000']);
    expect(summary(rows, [quotes[0]!], now).positions.map(p => p.allocationWeight)).toEqual([null, null]);
    expect(summary([], [], now)).toMatchObject({ valuationComplete: true, marketValue: '0.00', positions: [] });
  });
  it('rejects chronological oversells, wrong-security inventory, duplicate order, future trades and invalid inputs', () => {
    for (const rows of [[trade('SELL', '1', '1', '0', 1), trade('BUY', '2', '1', '0', 2)], [trade('BUY', '1', '1', '0', 1), trade('SELL', '1', '1', '0', 2, 'b')], [buys[0]!, buys[0]!], [trade('BUY', '-1', '1', '0', 1)], [trade('BUY', '0', '1', '0', 1)], [trade('BUY', '1', '1', '0', 1), trade('SELL', '1', '1', '2', 2)], [{ ...buys[0]!, occurredAt: '2027-01-01T00:00:00.000Z' }]]) expect(() => summary(rows, [], now)).toThrow();
    const equalTime = buys.map(t => ({ ...t, occurredAt: buys[0]!.occurredAt }));
    expect(summary(equalTime, [], now).remainingCostBasis).toBe('1603.00');
  });
  it('rounds half up only at output, including negative ties and aggregate totals', () => {
    expect(summary([trade('BUY', '1', '1.005', '0', 1)], [], now).remainingCostBasis).toBe('1.01');
    expect(summary([trade('BUY', '1', '1.005', '0', 1), trade('SELL', '1', '1', '0', 2)], [], now).realizedGainLoss).toBe('-0.01');
    expect(summary([trade('BUY', '1', '0.004', '0', 1), trade('BUY', '1', '0.004', '0', 2, 'b')], [], now).remainingCostBasis).toBe('0.01');
  });
});
