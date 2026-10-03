import { describe, expect, it } from 'vitest';
import { articleExposure } from './exposure.js';
import { evidenceSource, generateRecommendations, prohibitedContent, validateRecommendation, type AnalyzedArticle } from './research.js';

const analyzed = (id: string, label: 'positive' | 'negative' | 'mixed' | 'neutral', overrides: Partial<AnalyzedArticle['analysis']> = {}, publishedAt = '2026-10-01T12:00:00.000Z'): AnalyzedArticle => ({
  analysisId: `analysis-${id}`, articleId: id, title: `Title ${id}`, url: `https://example.com/${id}`, publishedAt, revisionKey: 'a'.repeat(64), securityIds: ['acme'],
  analysis: { eventCategories: ['guidance'], materiality: 'medium', sentiment: { label }, keyFacts: [{ statement: `The article reports fact ${id}.` }],
    uncertainties: [`Uncertainty ${id}.`], counterpoints: [`Counterpoint ${id}.`], primarySource: { recommended: false, reason: 'Not needed.' }, ...overrides }
});
const position = (securityId: string, market: string) => ({ securityId, symbol: securityId.toUpperCase(), exchangeMic: 'XNAS', remainingQuantity: '1.0000000000', remainingCostBasis: market, marketValue: market, quoteStatus: 'fresh' as const });
const concentrated = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [{ portfolioId: 'p1', name: 'Growth', positions: [position('acme', '600.00'), position('nova', '400.00')] }], watchlistSecurityIds: [] });
const diversified = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [{ portfolioId: 'p2', name: 'Core', positions: [position('acme', '100.00'), position('nova', '900.00')] }], watchlistSecurityIds: [] });
const watching = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [], watchlistSecurityIds: ['acme'] });
const securities = [{ securityId: 'acme', symbol: 'ACME' }];
const asOf = '2026-10-02T12:00:00.000Z';
const allowed = (...items: AnalyzedArticle[]) => new Map(items.map(a => [a.analysisId, a]));

describe('generateRecommendations', () => {
  it('produces owner-specific recommendations from the same shared analysis', () => {
    const subject = analyzed('raise', 'positive');
    const forHolder = generateRecommendations({ subject, related: [], exposure: concentrated, securities, asOf });
    const forDiversified = generateRecommendations({ subject, related: [], exposure: diversified, securities, asOf });
    const forWatcher = generateRecommendations({ subject, related: [], exposure: watching, securities, asOf });
    expect(forHolder.map(r => r.type)).toEqual(['monitor_event', 'review_concentration']);
    expect(forDiversified.map(r => r.type)).toEqual(['monitor_event']);
    expect(forWatcher.map(r => r.type)).toEqual(['monitor_event']);
    expect(forHolder[1]!.rationale).toContain('ACME is 60.00% of the Growth portfolio on a market-value basis, at or above the 20.00% review threshold');
    expect(forDiversified[0]!.rationale).toContain('10.00% of the combined value of all your active portfolios on a market-value basis');
    expect(forWatcher[0]!).toMatchObject({ affectedHoldings: [], affectedSecurities: [{ securityId: 'acme', symbol: 'ACME', relation: 'watchlisted' }] });
    expect(forWatcher[0]!.rationale).toContain('on your watchlist and not currently held');
    for (const draft of [...forHolder, ...forDiversified, ...forWatcher]) {
      expect(draft.evidence.length).toBeGreaterThan(0);
      expect(draft.uncertainties.length).toBeGreaterThan(0);
      expect(draft.counterarguments.length).toBeGreaterThan(0);
      expect(draft.asOf).toBe(asOf);
      expect(validateRecommendation(draft, allowed(subject))).toEqual({ ok: true });
    }
  });

  it('turns contradictory reports into reassess and read-primary-source recommendations citing both', () => {
    const raise = analyzed('raise', 'positive');
    const cut = analyzed('cut', 'negative', {}, '2026-10-02T09:00:00.000Z');
    const drafts = generateRecommendations({ subject: cut, related: [raise], exposure: diversified, securities, asOf });
    expect(drafts.map(r => r.type)).toEqual(['monitor_event', 'read_primary_source', 'reassess_assumptions']);
    const reassess = drafts.find(d => d.type === 'reassess_assumptions')!;
    expect(reassess.evidenceArticleIds).toEqual(['cut', 'raise']);
    expect(reassess.analysisIds).toEqual(['analysis-cut', 'analysis-raise']);
    expect(reassess.counterarguments[0]).toBe('Opposing report "Title raise": The article reports fact raise.');
    expect(reassess.rationale).toContain('This article reads negative while 1 other recent report about the same holding read positive.');
    expect(validateRecommendation(reassess, allowed(raise, cut))).toEqual({ ok: true });
    // Out of the comparison window, or the same polarity: not a contradiction.
    expect(generateRecommendations({ subject: cut, related: [analyzed('old', 'positive', {}, '2026-09-01T00:00:00.000Z')], exposure: diversified, securities, asOf }).map(d => d.type)).toEqual(['monitor_event']);
    expect(generateRecommendations({ subject: cut, related: [analyzed('also-bad', 'negative')], exposure: diversified, securities, asOf }).map(d => d.type)).toEqual(['monitor_event']);
    // A watcher is told to read the source but has no held assumptions to reassess.
    expect(generateRecommendations({ subject: cut, related: [raise], exposure: watching, securities, asOf }).map(d => d.type)).toEqual(['monitor_event', 'read_primary_source']);
  });

  it('suggests nothing for neutral, immaterial news and for owners with no relation', () => {
    const neutral = analyzed('conference', 'neutral', { eventCategories: ['other'], materiality: 'none' });
    expect(generateRecommendations({ subject: neutral, related: [], exposure: concentrated, securities, asOf })).toEqual([]);
    const none = articleExposure({ affectedSecurityIds: ['acme'], portfolios: [], watchlistSecurityIds: [] });
    expect(generateRecommendations({ subject: analyzed('raise', 'positive'), related: [], exposure: none, securities, asOf })).toEqual([]);
  });

  it('recommends reading the primary source when the analysis says so, even for immaterial news', () => {
    const filing = analyzed('filing', 'neutral', { materiality: 'none', primarySource: { recommended: true, reason: 'The article summarizes a regulatory filing.' } });
    const drafts = generateRecommendations({ subject: filing, related: [], exposure: diversified, securities, asOf });
    expect(drafts.map(d => d.type)).toEqual(['read_primary_source']);
    expect(drafts[0]!.rationale).toContain('The article summarizes a regulatory filing.');
  });
});

describe('validateRecommendation', () => {
  const subject = analyzed('raise', 'positive');
  const draft = () => generateRecommendations({ subject, related: [], exposure: diversified, securities, asOf })[0]!;
  it('rejects evidence that is not a supplied analysis of the cited article', () => {
    expect(validateRecommendation({ ...draft(), evidence: [{ articleId: 'elsewhere', analysisId: 'analysis-raise', statement: 'x' }] }, allowed(subject))).toMatchObject({ ok: false, code: 'unsupported_source' });
    expect(validateRecommendation({ ...draft(), evidence: [{ articleId: 'raise', analysisId: 'analysis-invented', statement: 'x' }] }, allowed(subject))).toMatchObject({ ok: false, code: 'unsupported_source' });
    expect(validateRecommendation(draft(), allowed())).toMatchObject({ ok: false, code: 'unsupported_source' });
    expect(validateRecommendation({ ...draft(), evidence: [{ articleId: 'raise', analysisId: 'analysis-raise', statement: 'Invented fact' }] }, allowed(subject))).toMatchObject({ ok: false, code: 'unsupported_source', issues: ['evidence.0.statement: not a supplied source fact'] });
  });
  it('rejects incomplete drafts and prohibited conclusions', () => {
    expect(validateRecommendation({ ...draft(), counterarguments: [] }, allowed(subject))).toMatchObject({ ok: false, code: 'incomplete', issues: ['counterarguments: empty'] });
    expect(validateRecommendation({ ...draft(), rationale: 'ACME will reach $250 by year end.' }, allowed(subject))).toMatchObject({ ok: false, code: 'prohibited_content', issues: ['rationale: price_target'] });
    expect(validateRecommendation({ ...draft(), counterarguments: ['Buy now before the report.'] }, allowed(subject))).toMatchObject({ ok: false, code: 'prohibited_content', issues: ['counterarguments.0: trade_instruction'] });
  });
});

describe('policy guards', () => {
  it('flags price targets, trade instructions, certainty and probabilities but not cautious language', () => {
    expect(prohibitedContent('Analysts set a price target of 300')).toBe('price_target');
    expect(prohibitedContent('The shares could rise to $40')).toBe('price_target');
    expect(prohibitedContent('Execute the trade at the open')).toBe('trade_instruction');
    expect(prohibitedContent('Gains are guaranteed')).toBe('certainty');
    expect(prohibitedContent('There is a 70% chance of a beat')).toBe('probability');
    expect(prohibitedContent('Following later reporting is a research step, not a trade instruction. This is not advice to buy or sell.')).toBeNull();
  });
  it('accepts only supported providers with safe URLs and content', () => {
    const article = { provider: 'portfolio-pilot-mock', url: 'https://example.com/a', title: 'T', summary: 'S' };
    expect(evidenceSource(article)).toEqual({ supported: true });
    expect(evidenceSource({ ...article, provider: 'unknown-blog' })).toEqual({ supported: false, reason: 'provider_not_allowed' });
    expect(evidenceSource({ ...article, url: 'javascript:alert(1)' })).toEqual({ supported: false, reason: 'invalid_url' });
    expect(evidenceSource({ ...article, url: 'https://user:pw@example.com/a' })).toEqual({ supported: false, reason: 'invalid_url' });
    expect(evidenceSource({ ...article, summary: '  ' })).toEqual({ supported: false, reason: 'empty_content' });
  });
});
