import { describe, expect, it } from 'vitest';
import { articleExposure, atOrAbove } from './exposure.js';

// Reference weights were computed independently with Python fractions + Decimal ROUND_HALF_UP.
const position = (securityId: string, quantity: string, cost: string, market: string | null) => ({
  securityId, symbol: securityId.toUpperCase(), exchangeMic: 'XNAS', remainingQuantity: quantity, remainingCostBasis: cost, marketValue: market,
  quoteStatus: market === null ? 'stale' as const : 'fresh' as const
});
const growth = (novaMarket: string | null = '500.50') => ({ portfolioId: 'p-a', name: 'Growth', positions: [position('acme', '8.0000000000', '802.00', '1001.00'), position('nova', '4.0000000000', '200.00', novaMarket)] });
const longTerm = { portfolioId: 'p-b', name: 'Long term', positions: [position('zeta', '10.0000000000', '1000.00', '1200.00'), position('acme', '2.0000000000', '180.00', '250.25'), position('gone', '0.0000000000', '0.00', null)] };

describe('articleExposure', () => {
  it('computes exact market-value weights per portfolio and in aggregate', () => {
    const result = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [longTerm, growth()], watchlistSecurityIds: [] });
    expect(result).toMatchObject({ relevance: 'held', basis: 'market_value', affectedValue: '1251.25', totalValue: '2951.75', weight: '0.4239010756', largestHoldingWeight: '0.6666666667', concentrationThreshold: '0.2' });
    expect(result.portfolios).toEqual([
      { portfolioId: 'p-a', name: 'Growth', affectedValue: '1001.00', totalValue: '1501.50', weight: '0.6666666667' },
      { portfolioId: 'p-b', name: 'Long term', affectedValue: '250.25', totalValue: '1450.25', weight: '0.1725564558' }
    ]);
    expect(result.holdings.map(h => [h.portfolioId, h.securityId, h.value, h.weight, h.valueBasis])).toEqual([['p-a', 'acme', '1001.00', '0.6666666667', 'market_value'], ['p-b', 'acme', '250.25', '0.1725564558', 'market_value']]);
  });

  it('falls back to cost basis for every portfolio when any open quote is not fresh, ignoring closed positions', () => {
    const result = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [growth(null), longTerm], watchlistSecurityIds: [] });
    expect(result).toMatchObject({ basis: 'cost_basis', affectedValue: '982.00', totalValue: '2182.00', weight: '0.4500458295', largestHoldingWeight: '0.8003992016' });
    expect(result.holdings.map(h => h.weight)).toEqual(['0.8003992016', '0.1525423729']);
    expect(result.holdings.every(h => h.valueBasis === 'cost_basis')).toBe(true);
  });

  it('gives the same article different relevance for different owners', () => {
    const holder = articleExposure({ affectedSecurityIds: ['acme', 'nova'], portfolios: [growth()], watchlistSecurityIds: [] });
    const watcher = articleExposure({ affectedSecurityIds: ['acme', 'nova'], portfolios: [longTerm], watchlistSecurityIds: ['nova', 'other'] });
    const stranger = articleExposure({ affectedSecurityIds: ['acme', 'nova'], portfolios: [], watchlistSecurityIds: [] });
    expect(holder.relevance).toBe('held');
    expect(holder.weight).toBe('1.0000000000');
    expect(watcher).toMatchObject({ relevance: 'held', watchlistedSecurityIds: ['nova'] });
    expect(articleExposure({ affectedSecurityIds: ['nova'], portfolios: [longTerm], watchlistSecurityIds: ['nova'] })).toMatchObject({ relevance: 'watchlisted', holdings: [], affectedValue: '0.00', weight: '0.0000000000' });
    expect(stranger).toMatchObject({ relevance: 'none', basis: null, totalValue: '0.00', weight: null, largestHoldingWeight: null });
  });

  it('rejects stale market values as a weight basis even when a value was supplied', () => {
    const portfolio = growth();
    const stale = { ...portfolio, positions: portfolio.positions.map(p => ({ ...p, quoteStatus: 'stale' as const })) };
    const exposure = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [stale], watchlistSecurityIds: [] });
    expect(exposure).toMatchObject({ basis: 'cost_basis', affectedValue: '802.00', totalValue: '1002.00', weight: '0.8003992016' });
    expect(exposure.holdings[0]).toMatchObject({ quoteStatus: 'stale', valueBasis: 'cost_basis' });
  });

  it('handles large calculated values without floating point and validates the threshold', () => {
    const big = { portfolioId: 'p', name: 'Big', positions: [position('a', '1.0000000000', '1', '90071992547409930.01'), position('b', '1.0000000000', '1', '90071992547409930.02')] };
    expect(articleExposure({ affectedSecurityIds: ['b'], portfolios: [big], watchlistSecurityIds: [] }).weight).toBe('0.5000000000');
    expect(() => articleExposure({ affectedSecurityIds: [], portfolios: [], watchlistSecurityIds: [], concentrationThreshold: '0' })).toThrow();
    expect(atOrAbove('0.2000000000', '0.2')).toBe(true);
    expect(atOrAbove('0.1999999999', '0.2')).toBe(false);
    expect(atOrAbove(null, '0.2')).toBe(false);
  });
});
