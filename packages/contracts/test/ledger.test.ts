import { describe, expect, it } from 'vitest';
import { decimalStringSchema, securityIdentitySchema } from '../src/index.js';
describe('ledger wire types', () => {
  it('accepts precise fixed-point strings and rejects numbers/exponents', () => {
    expect(decimalStringSchema.parse('0.0000000001')).toBe('0.0000000001');
    expect(decimalStringSchema.parse('123456789012345678.1234567890')).toBe('123456789012345678.1234567890');
    expect(decimalStringSchema.safeParse(0.1).success).toBe(false);
    expect(decimalStringSchema.safeParse('1e-10').success).toBe(false);
  });
  it('requires an exchange-aware USD identity', () => {
    expect(securityIdentitySchema.safeParse({ symbol: 'ACME', exchangeMic: 'XNAS', currency: 'USD' }).success).toBe(true);
    expect(securityIdentitySchema.safeParse({ symbol: 'ACME', currency: 'USD' }).success).toBe(false);
    expect(securityIdentitySchema.safeParse({ symbol: 'ACME', exchangeMic: 'XNAS', currency: 'EUR' }).success).toBe(false);
  });
});
