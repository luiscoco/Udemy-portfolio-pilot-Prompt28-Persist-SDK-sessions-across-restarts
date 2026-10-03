import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SENTIMENT_NOTE, type ArticleImpact, type Recommendation } from '@portfolio-pilot/contracts';
import { ImpactView, RecommendationCard } from './research';

const recommendation: Recommendation = {
  id: 'r1', disposition: 'new', articleId: 'a1', type: 'monitor_event', status: 'stale', staleReasons: ['article_corrected'], title: '<script>unsafe</script>', rationale: 'Review later reporting.',
  evidence: [{ articleId: 'a1', analysisId: 'analysis1', title: 'Report', url: 'javascript:alert(1)', publishedAt: '2026-09-25T12:00:00.000Z', revisionKey: 'old', statement: '<b>Attributed report</b>', status: 'corrected' }],
  affectedHoldings: [], affectedSecurities: [{ securityId: 's1', symbol: 'ACME', relation: 'watchlisted' }], uncertainties: ['Only a summary.'], counterarguments: ['The report can change.'],
  sentiment: { label: 'neutral', note: SENTIMENT_NOTE }, asOf: '2026-10-02T12:00:00.000Z', createdAt: '2026-10-02T12:00:00.000Z',
  provenance: { generatorVersion: 'research-rules-v1', analysisIds: ['analysis1'], promptVersion: 'p1', schemaVersion: 'article-analysis-v1', modelKey: 'mock:test', portfolioFingerprint: 'private', exposureBasis: null }
};
const impact: ArticleImpact = { articleId: 'a1', state: 'current', staleReasons: [], failureCode: null, analysis: null, exposure: null, recommendations: [], computedAt: recommendation.asOf, analysisReused: true,
  policy: { evidenceAgedAfterMs: 259200000, concentrationThreshold: '0.2', generatorVersion: 'research-rules-v1' } };

describe('private research presentation', () => {
  it('shows correction caveats, evidence, counterarguments and as-of while keeping provider content inert', () => {
    const html = renderToStaticMarkup(<RecommendationCard recommendation={recommendation} />);
    for (const text of ['OUT OF DATE', 'the article was corrected', 'Corrected since this was written', 'Uncertainties', 'Counterarguments', SENTIMENT_NOTE, 'As of']) expect(html).toContain(text);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<b>Attributed'); expect(html).not.toContain('href="javascript:');
  });
  it('shows aged evidence and safe links with referrer protection', () => {
    const html = renderToStaticMarkup(<RecommendationCard recommendation={{ ...recommendation, evidence: [{ ...recommendation.evidence[0]!, status: 'aged', url: 'https://example.com/report' }] }} />);
    expect(html).toContain('Older than 72 hours'); expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('referrerPolicy="no-referrer"');
  });
  it('makes no-action and rejected-source states explicit', () => {
    expect(renderToStaticMarkup(<ImpactView impact={impact} />)).toContain('No research action suggested');
    const html = renderToStaticMarkup(<ImpactView impact={{ ...impact, state: 'unsupported_source', failureCode: 'unsupported_source' }} onRecalculate={() => {}} />);
    expect(html).toContain('not supported as evidence'); expect(html).not.toContain('<button');
  });
});

