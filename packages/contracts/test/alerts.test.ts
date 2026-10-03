import { describe, it, expect } from 'vitest';
import { alertRuleWriteSchema } from '../src/alerts.js';
describe('strict user-configured alert rules', () => {
  it('rejects injected identity, categories, malformed thresholds and excessive cooldowns', () => {
    for (const change of [{ userId: 'other' }, { categories: ['invented'] }, { concentrationThreshold: '1.0000000001' }, { relevanceThreshold: '-0.1' }, { relevanceThreshold: 0.1 }, { cooldownSeconds: 86401 }]) {
      expect(alertRuleWriteSchema.safeParse({ name: 'Rule', ...change }).success).toBe(false);
    }
  });
  it('preserves decimal strings, empty filters and zero cooldown', () => {
    expect(alertRuleWriteSchema.parse({ name: ' Rule ', concentrationThreshold: '0.2000000000', cooldownSeconds: 0 })).toMatchObject({ name: 'Rule', concentrationThreshold: '0.2000000000', relevanceThreshold: null, cooldownSeconds: 0, categories: [], securityIds: [] });
  });
});
