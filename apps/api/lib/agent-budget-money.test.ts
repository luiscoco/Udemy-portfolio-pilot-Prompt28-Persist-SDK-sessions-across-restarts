import { expect, it } from 'vitest';
import { usdMicros, usdString } from './agent-budget-money';
it('rounds SDK estimates upward and daily allowance downward using exact decimal units', () => {
  expect(usdString(usdMicros(0.129999, 'up'))).toBe('0.129999');
  expect(usdString(usdMicros(1e-7, 'up'))).toBe('0.000001');
  expect(usdMicros(1e-7, 'down')).toBe(0);
  expect(usdMicros(1e-6, 'down')).toBe(1);
  expect(usdMicros(0.30000000000000004, 'up')).toBe(300001);
  expect(usdMicros(Infinity, 'up')).toBeNaN();
  expect(usdMicros(-1, 'up')).toBeNaN();
});
