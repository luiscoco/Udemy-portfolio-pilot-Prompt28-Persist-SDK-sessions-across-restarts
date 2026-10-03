import { expect, it } from 'vitest';
import { largestHolding } from './largest-holding.js';
it('combines security exposure exactly, withholds incomplete valuations and identifies ties', () => {
  const position = (securityId: string, marketValue: string | null) => ({ securityId, symbol: securityId, marketValue });
  expect(largestHolding([position('a', '9007199254740993.01'), position('b', '9007199254740993.02')])?.securityId).toBe('b');
  expect(largestHolding([position('a', '999999999999999999999999.01'), position('b', '999999999999999999999999.02')])?.securityId).toBe('b');
  expect(largestHolding([position('a', '0.1'), position('a', '0.2'), position('b', '0.29')])).toMatchObject({ securityId: 'a', marketValue: '0.30', tied: false });
  expect(largestHolding([position('a', '1'), position('b', null)])).toBeNull();
  expect(largestHolding([])).toBeNull();
  expect(largestHolding([position('a', '1'), position('b', '1')])?.tied).toBe(true);
});
