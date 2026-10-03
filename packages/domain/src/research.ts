import { ExactDecimal as D } from './decimal.js';
import { atOrAbove, type ArticleExposureResult, type ExposureHolding } from './exposure.js';

/**
 * Deterministic research-recommendation rules (milestone 21). No model writes a recommendation: the
 * model only produces a shared, per-article analysis; these rules combine it with the owner's exposure.
 * That keeps recommendations reproducible, cheap to recalculate and free of invented price targets.
 */
export const RESEARCH_POLICY = {
  generatorVersion: 'research-rules-v1',
  /** Evidence older than this (by publication time) is labeled "aged" when displayed. */
  evidenceAgedAfterMs: 72 * 3600_000,
  /** Reports about the same security within this window are compared for contradictions. */
  contradictionWindowMs: 7 * 86400_000,
  maxRelatedArticles: 5, maxContradictions: 3, maxEvidencePerArticle: 3
} as const;

/** Providers whose normalized articles may be used as evidence. Anything else is rejected before analysis. */
export const SUPPORTED_EVIDENCE_PROVIDERS = ['portfolio-pilot-mock', 'alpaca-iex-benzinga', 'synthetic-fixture', 'development-fixture'] as const;
export type EvidenceSourceDecision = { supported: true } | { supported: false; reason: 'provider_not_allowed' | 'invalid_url' | 'empty_content' };
export function evidenceSource(article: Readonly<{ provider: string; url: string; title: string; summary: string }>): EvidenceSourceDecision {
  if (!(SUPPORTED_EVIDENCE_PROVIDERS as readonly string[]).includes(article.provider)) return { supported: false, reason: 'provider_not_allowed' };
  try {
    const url = new URL(article.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) return { supported: false, reason: 'invalid_url' };
  } catch { return { supported: false, reason: 'invalid_url' }; }
  if (!article.title.trim() || !article.summary.trim()) return { supported: false, reason: 'empty_content' };
  return { supported: true };
}

/**
 * Text the application must never present as its own conclusion: price targets, trade instructions,
 * certainty and probability language. Returns the rule name, or null. Applied to analyzer judgments
 * and to every generated recommendation field; attributed article facts are not the app's claims.
 */
const PROHIBITED: ReadonlyArray<readonly [string, RegExp]> = [
  ['price_target', /\b(price[- ]targets?|target[- ]prices?|fair[- ]value (of|at)|PT (of|at)\b)/i],
  ['price_target', /\b(will|should|could|likely to|expected to)\s+(reach|hit|trade (at|to)|rise to|fall to|climb to|drop to)\s+(US)?\$?\s?\d/i],
  ['trade_instruction', /\b(buy|sell|short|purchase|dump|trim|add to)\s+(now|today|immediately|more|shares|the stock|your position|it)\b/i],
  ['trade_instruction', /\b(place|execute|submit)\s+(an?\s+|the\s+)?(order|trade)s?\b/i],
  ['certainty', /\b(guaranteed|certain to|definitely will|risk[- ]free|cannot lose|sure thing)\b/i],
  ['probability', /\b\d{1,3}(\.\d+)?\s?%\s+(chance|probability|likelihood|likely)\b|\bprobability of\b/i]
];
export function prohibitedContent(text: string): string | null {
  for (const [rule, pattern] of PROHIBITED) if (pattern.test(text)) return rule;
  return null;
}

export type Sentiment = 'positive' | 'negative' | 'mixed' | 'neutral';
export type Materiality = 'none' | 'low' | 'medium';
/** A validated shared analysis plus the article revision it describes. Contains no owner data. */
export interface AnalyzedArticle {
  analysisId: string; articleId: string; title: string; url: string; publishedAt: string; revisionKey: string; securityIds: readonly string[];
  analysis: Readonly<{
    eventCategories: readonly string[]; materiality: Materiality; sentiment: Readonly<{ label: Sentiment }>;
    keyFacts: ReadonlyArray<Readonly<{ statement: string }>>; uncertainties: readonly string[]; counterpoints: readonly string[];
    primarySource: Readonly<{ recommended: boolean; reason: string }>;
  }>;
}
export type RecommendationKind = 'monitor_event' | 'review_concentration' | 'read_primary_source' | 'reassess_assumptions';
export interface RecommendationDraft {
  type: RecommendationKind; title: string; rationale: string;
  evidence: { articleId: string; analysisId: string; statement: string }[];
  affectedHoldings: ExposureHolding[];
  affectedSecurities: { securityId: string; symbol: string; relation: 'held' | 'watchlisted' }[];
  uncertainties: string[]; counterarguments: string[]; sentiment: Sentiment; asOf: string;
  /** Every analysis the draft relies on; the persistence layer adds the portfolio fingerprint. */
  analysisIds: string[]; evidenceArticleIds: string[];
}

const SENTIMENT_UNCERTAINTY = 'Sentiment describes the tone of the reporting. It is not a forecast or a calibrated probability.';
const SUMMARY_ONLY = 'The analysis covers only the provider headline and summary, not the full article.';
const percent = (weight: string) => `${new D(BigInt(weight.replace('.', '')), 10n ** BigInt(weight.split('.')[1]?.length ?? 0)).multiply(new D(100n)).fixed(2)}%`;
const basisText = (basis: ArticleExposureResult['basis']) => basis === 'market_value' ? 'market-value' : 'cost-basis';
const list = (items: readonly string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const unique = (items: readonly string[]) => [...new Set(items.map(s => s.trim()).filter(Boolean))];
const opposite = (a: Sentiment, b: Sentiment) => (a === 'positive' && b === 'negative') || (a === 'negative' && b === 'positive');
const facts = (article: AnalyzedArticle, limit: number = RESEARCH_POLICY.maxEvidencePerArticle) =>
  article.analysis.keyFacts.slice(0, limit).map(f => ({ articleId: article.articleId, analysisId: article.analysisId, statement: f.statement }));

/**
 * Generates zero or more drafts for one owner and one article. Neutral, immaterial reporting with no
 * contradiction produces none: "no research action suggested" is a valid, explicit outcome.
 */
export function generateRecommendations(input: {
  subject: AnalyzedArticle; related: readonly AnalyzedArticle[]; exposure: ArticleExposureResult;
  securities: readonly { securityId: string; symbol: string }[]; asOf: string;
}): RecommendationDraft[] {
  const { subject, exposure } = input;
  if (exposure.relevance === 'none') return [];
  const symbolOf = (id: string) => input.securities.find(s => s.securityId === id)?.symbol ?? id;
  const held = [...new Set(exposure.holdings.map(h => h.securityId))].sort();
  const watchlisted = exposure.watchlistedSecurityIds.filter(id => !held.includes(id));
  const relevant = new Set([...held, ...watchlisted]);
  const affectedSecurities = [...held.map(id => ({ securityId: id, symbol: symbolOf(id), relation: 'held' as const })), ...watchlisted.map(id => ({ securityId: id, symbol: symbolOf(id), relation: 'watchlisted' as const }))];
  const symbols = list(affectedSecurities.map(s => s.symbol));
  const a = subject.analysis;
  const material = a.materiality !== 'none';
  const subjectTime = Date.parse(subject.publishedAt);
  const contradictions = input.related
    .filter(r => r.articleId !== subject.articleId && r.securityIds.some(id => relevant.has(id))
      && Math.abs(Date.parse(r.publishedAt) - subjectTime) <= RESEARCH_POLICY.contradictionWindowMs && opposite(a.sentiment.label, r.analysis.sentiment.label))
    .sort((x, y) => Date.parse(y.publishedAt) - Date.parse(x.publishedAt) || x.articleId.localeCompare(y.articleId))
    .slice(0, RESEARCH_POLICY.maxContradictions);
  const base = { affectedSecurities, sentiment: a.sentiment.label, asOf: input.asOf };
  const basisNote = exposure.basis === 'cost_basis' ? ['Weights use cost basis because at least one holding has no fresh quote; market-value weights may differ.'] : [];
  const holdingText = held.length
    ? `${list(held.map(symbolOf))} ${held.length === 1 ? 'is' : 'are'} held in ${exposure.portfolios.length} of your portfolios, ${exposure.weight === null ? 'with no measurable weight' : `representing ${percent(exposure.weight)}`} of the combined value of all your active portfolios on a ${basisText(exposure.basis)} basis.`
    : `${list(watchlisted.map(symbolOf))} ${watchlisted.length === 1 ? 'is' : 'are'} on your watchlist and not currently held.`;
  const categories = list(a.eventCategories.map(c => c.replace(/_/g, ' ')));
  const drafts: RecommendationDraft[] = [];
  const draft = (d: Omit<RecommendationDraft, 'analysisIds' | 'evidenceArticleIds' | keyof typeof base>) => drafts.push({ ...base, ...d,
    analysisIds: unique(d.evidence.map(e => e.analysisId)).sort(), evidenceArticleIds: unique(d.evidence.map(e => e.articleId)).sort() });

  if (material) draft({
    type: 'monitor_event', title: `Monitor ${categories} reporting for ${symbols}`,
    rationale: `${holdingText} The shared analysis classifies the reported ${categories} event as ${a.materiality} materiality. Following later reporting is a research step, not a trade instruction.`,
    evidence: facts(subject), affectedHoldings: exposure.holdings,
    uncertainties: unique([...a.uncertainties, SENTIMENT_UNCERTAINTY, ...basisNote]),
    counterarguments: unique([...a.counterpoints, 'A single report may already be reflected in market prices, or may be revised later.'])
  });
  const concentrated = exposure.holdings.filter(h => atOrAbove(h.weight, exposure.concentrationThreshold));
  if (material && concentrated.length) draft({
    type: 'review_concentration', title: `Review concentration in ${list(unique(concentrated.map(h => h.symbol)))}`,
    rationale: `${concentrated.map(h => `${h.symbol} is ${percent(h.weight!)} of the ${h.portfolioName} portfolio on a ${basisText(h.valueBasis)} basis`).join('; ')}, at or above the ${percent(exposure.concentrationThreshold)} review threshold, and this article reports a ${a.materiality}-materiality event. Check whether this concentration is still intended; this is not advice to change the position.`,
    evidence: facts(subject, 1), affectedHoldings: concentrated,
    uncertainties: unique([`The ${percent(exposure.concentrationThreshold)} threshold is a fixed application policy, not a personal risk limit.`, ...basisNote, ...a.uncertainties.slice(0, 1)]),
    counterarguments: ['Concentration can be deliberate and consistent with your plan.', 'Weights move with prices; the figures are as of the stated time.']
  });
  if (a.primarySource.recommended || contradictions.length) draft({
    type: 'read_primary_source', title: `Read the primary source behind this ${symbols} report`,
    rationale: `${contradictions.length ? `Reports about ${symbols} disagree, so the original disclosure is the better reference. ` : ''}${a.primarySource.reason} The provider supplies only a headline and summary.`,
    evidence: [...facts(subject, 1), ...contradictions.flatMap(c => facts(c, 1))], affectedHoldings: exposure.holdings,
    uncertainties: unique([SUMMARY_ONLY, ...a.uncertainties.slice(0, 1)]),
    counterarguments: ['The summary may already describe the primary disclosure accurately.']
  });
  if (held.length && contradictions.length) draft({
    type: 'reassess_assumptions', title: `Reassess assumptions about ${list(held.map(symbolOf))}`,
    rationale: `This article reads ${a.sentiment.label} while ${contradictions.length} other recent report${contradictions.length === 1 ? '' : 's'} about the same holding read ${list(unique(contradictions.map(c => c.analysis.sentiment.label)))}. ${holdingText} Compare the assumptions behind the position with both accounts.`,
    evidence: [...facts(subject, 2), ...contradictions.flatMap(c => facts(c, 2))], affectedHoldings: exposure.holdings,
    uncertainties: unique(['It is not established which report is more accurate.', SENTIMENT_UNCERTAINTY, ...a.uncertainties.slice(0, 1), ...contradictions.flatMap(c => c.analysis.uncertainties.slice(0, 1))]),
    counterarguments: unique([...contradictions.flatMap(c => c.analysis.keyFacts.slice(0, 1).map(f => `Opposing report "${c.title}": ${f.statement}`)), ...a.counterpoints.slice(0, 2)])
  });
  return drafts;
}

export type RecommendationValidation = { ok: true } | { ok: false; code: 'unsupported_source' | 'incomplete' | 'prohibited_content'; issues: string[] };
/**
 * Every draft is checked before it is persisted: evidence may cite only the analyses supplied for this
 * calculation (each analysis ID must belong to the cited article), every required field is present, and
 * no generated text contains a price target, trade instruction, certainty or probability claim.
 */
export function validateRecommendation(draft: RecommendationDraft, allowed: ReadonlyMap<string, AnalyzedArticle>): RecommendationValidation {
  const unsupported = draft.evidence.flatMap((e, i) => allowed.get(e.analysisId)?.articleId === e.articleId ? [] : [`evidence.${i}: not a supplied analysis of the cited article`]);
  draft.evidence.forEach((e, i) => {
    const source = allowed.get(e.analysisId);
    if (source?.articleId === e.articleId && !source.analysis.keyFacts.some(f => f.statement === e.statement)) unsupported.push(`evidence.${i}.statement: not a supplied source fact`);
  });
  for (const [i, id] of draft.analysisIds.entries()) if (!allowed.has(id)) unsupported.push(`analysisIds.${i}: unknown analysis`);
  if (unsupported.length) return { ok: false, code: 'unsupported_source', issues: unsupported };
  const incomplete: string[] = [];
  if (!draft.rationale.trim()) incomplete.push('rationale: empty');
  if (!draft.evidence.length) incomplete.push('evidence: empty');
  if (!draft.uncertainties.length) incomplete.push('uncertainties: empty');
  if (!draft.counterarguments.length) incomplete.push('counterarguments: empty');
  if (!draft.affectedSecurities.length) incomplete.push('affectedSecurities: empty');
  if (!Number.isFinite(Date.parse(draft.asOf))) incomplete.push('asOf: invalid');
  if (incomplete.length) return { ok: false, code: 'incomplete', issues: incomplete };
  const texts: Array<[string, string]> = [['title', draft.title], ['rationale', draft.rationale], ...draft.uncertainties.map((t, i) => [`uncertainties.${i}`, t] as [string, string]), ...draft.counterarguments.map((t, i) => [`counterarguments.${i}`, t] as [string, string])];
  const prohibited = texts.flatMap(([path, text]) => { const rule = prohibitedContent(text); return rule ? [`${path}: ${rule}`] : []; });
  return prohibited.length ? { ok: false, code: 'prohibited_content', issues: prohibited } : { ok: true };
}

