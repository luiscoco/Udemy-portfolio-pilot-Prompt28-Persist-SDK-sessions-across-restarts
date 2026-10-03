import { expect, it } from 'vitest';
import { decimalDisplay, money, percent, quantity } from './decimal-display';
it('formats large and fractional decimals without floating point or altering inputs', () => {
  expect(decimalDisplay('999999999999999999.995')).toBe('1,000,000,000,000,000,000.00');
  expect(decimalDisplay('-1.005')).toBe('-1.01');
  expect(decimalDisplay('-0.0001')).toBe('0.00');
  expect(quantity('0.0000000001')).toBe('0.0000000001');
  expect(quantity('9.0000000000')).toBe('9');
  expect(percent('0.3333333333')).toBe('33.33%');
  expect(money(null)).toBe('Unavailable');
});
