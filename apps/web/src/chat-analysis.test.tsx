import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NewsAnalysis } from '@portfolio-pilot/contracts';
import { AnalysisView, ContinuityNote } from './chat';

const sources = [{ articleId: 'a1', title: 'Article', url: 'https://example.invalid/a1', publishedAt: '2026-10-02T11:00:00.000Z', isSynthetic: true }];
const analysis: NewsAnalysis = {
  schemaVersion: 'news-analysis-v1', asOf: '2026-10-02T12:00:00.000Z', articles: [{ articleId: 'a1', title: 'Article', publishedAt: '2026-10-02T11:00:00.000Z' }],
  events: [{ category: 'regulatory_legal', description: '<b>Probe</b> opened', articleIds: ['a1'] }], affectedSecurities: [{ securityId: 's', symbol: 'NOVA', relation: 'held', articleIds: ['a1'] }],
  factualSummary: [{ statement: 'Fact one.', articleIds: ['a1', 'ghost'] }], interpretations: [], uncertainties: [{ statement: 'Synthetic.', articleIds: [] }],
  evidence: [{ articleId: 'a1', url: 'https://example.invalid/a1' }]
};

describe('assistant session continuity and structured analysis', () => {
  it('says plainly when an answer came from a new session seeded from a summary', () => {
    const html = renderToStaticMarkup(<ContinuityNote continuity={{ disposition: 'reseeded', reason: 'session_missing' }} />);
    expect(html).toContain('role="note"');
    expect(html).toContain('no longer stored on this server');
    expect(html).toContain('a summary of your saved messages, not the previous session itself');
    expect(renderToStaticMarkup(<ContinuityNote continuity={{ disposition: 'resumed', reason: null }} />)).toContain('Continued in the same assistant session.');
    expect(renderToStaticMarkup(<ContinuityNote continuity={null} />)).toBe('');
  });
  it('renders sections, escapes text and links only validated sources', () => {
    const html = renderToStaticMarkup(<AnalysisView analysis={analysis} sources={sources} />);
    for (const heading of ['Facts', 'Events', 'Affected securities', 'Interpretation', 'Uncertainties']) expect(html).toContain(`<h3>${heading}</h3>`);
    expect(html).toContain('&lt;b&gt;Probe&lt;/b&gt;');
    expect(html).toContain('href="https://example.invalid/a1"');
    expect(html).toContain('ghost (unverified)');
    expect(html).toContain('regulatory legal');
  });
});
