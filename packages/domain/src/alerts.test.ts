import { describe, it, expect } from 'vitest';
import { matchesAlert } from './alerts.js';
const rule = { enabled: true, categories: ['earnings'], securityIds: ['s'], concentrationThreshold: '0.2', relevanceThreshold: '0.1' };
const impact = { state: 'current', analysis: { analysis: { eventCategories: ['earnings'] } }, exposure: { relevance: 'held', holdings: [{ securityId: 's' }], watchlistedSecurityIds: [], largestHoldingWeight: '0.2000000000', weight: '0.1' } };
describe('deterministic alert thresholds', () => {
  it('includes exact boundaries and rejects the smallest decimal below', () => {
    expect(matchesAlert(rule, impact)).toBe(true);
    expect(matchesAlert(rule, { ...impact, exposure: { ...impact.exposure, largestHoldingWeight: '0.1999999999' } })).toBe(false);
    expect(matchesAlert(rule, { ...impact, exposure: { ...impact.exposure, weight: '0.0999999999' } })).toBe(false);
  });
  it('combines filters and withholds stale/irrelevant/disabled analysis', () => {
    for (const r of [{ ...rule, enabled: false }, { ...rule, categories: ['macro'] }, { ...rule, securityIds: ['foreign'] }]) expect(matchesAlert(r, impact)).toBe(false);
    expect(matchesAlert(rule, { ...impact, state: 'stale' })).toBe(false);
    expect(matchesAlert(rule, { ...impact, exposure: { ...impact.exposure, relevance: 'none' } })).toBe(false);
    expect(matchesAlert(rule, { ...impact, exposure: { ...impact.exposure, weight: null } })).toBe(false);
    expect(matchesAlert({ ...rule, concentrationThreshold: null, relevanceThreshold: null, categories: [], securityIds: [] }, { ...impact, exposure: { ...impact.exposure, relevance: 'watchlisted', weight: null, largestHoldingWeight: null } })).toBe(true);
  });
});
