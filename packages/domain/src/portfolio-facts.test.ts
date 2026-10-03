import { describe, expect, it } from 'vitest';
import { ExactDecimal } from './decimal.js';
import { classifyQuote, combinePortfolioTotals, valuationCoverage } from './portfolio-facts.js';

const now = '2026-10-02T12:00:00.000Z';
const quote = { price: '125.125', currency: 'USD', asOf: now };
const totals = { valuationComplete: true, remainingCostBasis: '961.80', soldCostBasis: '641.20', realizedGainLoss: '135.80', marketValue: '1125.00', unrealizedGainLoss: '163.20' };

describe('quote freshness classification', () => {
  it('uses the inclusive 15 minute boundary and reports integer age', () => {
    expect(classifyQuote({ ...quote, asOf: '2026-10-02T11:45:00.000Z' }, now)).toEqual({ status: 'fresh', ageMs: 900000 });
    expect(classifyQuote({ ...quote, asOf: '2026-10-02T11:44:59.999Z' }, now)).toEqual({ status: 'stale', ageMs: 900001 });
    expect(classifyQuote(quote, now, 0)).toEqual({ status: 'fresh', ageMs: 0 });
  });
  it('never treats missing, future, malformed, zero or non-USD quotes as usable', () => {
    expect(classifyQuote(null, now).status).toBe('missing');
    expect(classifyQuote({ ...quote, asOf: '2026-10-02T12:00:00.001Z' }, now).status).toBe('missing');
    expect(classifyQuote({ ...quote, asOf: 'yesterday' }, now).status).toBe('invalid');
    for (const bad of [{ price: '0' }, { price: '-1' }, { price: '1e3' }, { currency: 'EUR' }]) expect(classifyQuote({ ...quote, ...bad }, now).status).toBe('invalid');
    expect(() => classifyQuote(quote, now, -1)).toThrow();
  });
});

describe('exact cross-portfolio totals', () => {
  it('adds signed money exactly and withholds market value when any portfolio is incomplete', () => {
    const loss = { ...totals, realizedGainLoss: '-18.00', marketValue: '0.10', unrealizedGainLoss: '-0.20', remainingCostBasis: '0.30' };
    expect(combinePortfolioTotals([totals, loss])).toEqual({ currency: 'USD', portfolioCount: 2, valuationComplete: true,
      remainingCostBasis: '962.10', soldCostBasis: '1282.40', realizedGainLoss: '117.80', marketValue: '1125.10', unrealizedGainLoss: '163.00' });
    expect(combinePortfolioTotals([totals, { ...totals, valuationComplete: false, marketValue: null, unrealizedGainLoss: null }])).toMatchObject({ valuationComplete: false, marketValue: null, unrealizedGainLoss: null, realizedGainLoss: '271.60' });
    expect(combinePortfolioTotals([])).toMatchObject({ portfolioCount: 0, valuationComplete: true, marketValue: '0.00' });
  });
  it('parses signed decimals without accepting exponent or double signs', () => {
    expect(ExactDecimal.parseSigned('-0.01').fixed(2)).toBe('-0.01');
    for (const bad of ['--1', '-', '1e2', '+1']) expect(() => ExactDecimal.parseSigned(bad)).toThrow();
  });
});

describe('valuation coverage', () => {
  it('counts open positions by quote status and finds the oldest open quote', () => {
    expect(valuationCoverage([
      { remainingQuantity: '1.0000000000', quoteStatus: 'fresh', quote: { asOf: now } },
      { remainingQuantity: '2', quoteStatus: 'stale', quote: { asOf: '2026-10-01T12:00:00.000Z' } },
      { remainingQuantity: '0.0000000000', quoteStatus: 'not_required', quote: { asOf: '2020-01-01T00:00:00.000Z' } },
      { remainingQuantity: '3', quoteStatus: 'missing', quote: null }
    ])).toEqual({ openPositions: 3, closedPositions: 1, quoteStatus: { fresh: 1, stale: 1, missing: 1, invalid: 0 }, oldestOpenQuoteAsOf: '2026-10-01T12:00:00.000Z' });
  });
});
