import { expect, it } from 'vitest';
import { validateLongOnlyLedger } from './ledger.js';
it('detects negative inventory at every chronological prefix with exact fractional arithmetic', () => {
  const buy = { securityId: 'a', side: 'BUY' as const, quantity: '0.0000000003' };
  const sell = { ...buy, side: 'SELL' as const, quantity: '0.0000000001' };
  expect(validateLongOnlyLedger([buy, sell, sell, sell])).toBe(true);
  expect(validateLongOnlyLedger([buy, sell, sell, sell, sell])).toBe(false);
  expect(validateLongOnlyLedger([sell, buy])).toBe(false);
  expect(validateLongOnlyLedger([buy, { ...sell, securityId: 'b' }])).toBe(false);
});
