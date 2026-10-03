interface AlertRuleWrite { enabled: boolean; categories: readonly string[]; securityIds: readonly string[]; concentrationThreshold: string | null; relevanceThreshold: string | null }
interface ArticleImpact { state: string; exposure: { relevance: string; holdings: readonly { securityId: string }[]; watchlistedSecurityIds: readonly string[]; largestHoldingWeight: string | null; weight: string | null } | null; analysis: { analysis: { eventCategories: readonly string[] } | null } | null }
import { atOrAbove } from './exposure.js';

/** AND between filters; OR within categories/securities. No model or binary numeric thresholds. */
export function matchesAlert(rule: AlertRuleWrite, impact: ArticleImpact): boolean {
  const exposure = impact.exposure;
  const analysis = impact.analysis?.analysis;
  if (!rule.enabled || impact.state !== 'current' || !exposure || !analysis || exposure.relevance === 'none') return false;
  if (rule.categories.length && !rule.categories.some(c => analysis.eventCategories.includes(c))) return false;
  const affected = [...exposure.holdings.map(h => h.securityId), ...exposure.watchlistedSecurityIds];
  if (rule.securityIds.length && !rule.securityIds.some(id => affected.includes(id))) return false;
  if (rule.concentrationThreshold !== null && !atOrAbove(exposure.largestHoldingWeight, rule.concentrationThreshold)) return false;
  if (rule.relevanceThreshold !== null && !atOrAbove(exposure.weight, rule.relevanceThreshold)) return false;
  return true;
}

