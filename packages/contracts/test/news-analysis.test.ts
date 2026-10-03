import { describe, expect, it } from 'vitest';
import { chatMessageCreateSchema, chatMessageSchema, newsAnalysisSchema, sessionContinuitySchema } from '../src/index.js';

const analysis = {
  schemaVersion: 'news-analysis-v1', asOf: '2026-10-02T12:00:00.000Z',
  articles: [{ articleId: 'a1', title: 'T', publishedAt: '2026-10-02T11:00:00.000Z' }], events: [], affectedSecurities: [],
  factualSummary: [{ statement: 'Fact.', articleIds: ['a1'] }], interpretations: [], uncertainties: [{ statement: 'Unknown.', articleIds: [] }],
  evidence: [{ articleId: 'a1', url: 'https://example.invalid/a1' }]
};

describe('news analysis and session continuity contracts', () => {
  it('accepts the minimal analysis and rejects certainty, extra fields and missing uncertainty', () => {
    expect(newsAnalysisSchema.parse(analysis)).toEqual(analysis);
    expect(newsAnalysisSchema.safeParse({ ...analysis, interpretations: [{ statement: 'Up.', confidence: 'high', articleIds: ['a1'] }] }).success).toBe(false);
    expect(newsAnalysisSchema.safeParse({ ...analysis, priceTarget: '1' }).success).toBe(false);
    expect(newsAnalysisSchema.safeParse({ ...analysis, uncertainties: [] }).success).toBe(false);
    expect(newsAnalysisSchema.safeParse({ ...analysis, articles: [] }).success).toBe(false);
  });
  it('defaults run kind and keeps older messages readable', () => {
    expect(chatMessageCreateSchema.parse({ content: 'Hi' })).toEqual({ content: 'Hi', kind: 'answer' });
    expect(chatMessageCreateSchema.safeParse({ content: 'Hi', kind: 'trade' }).success).toBe(false);
    const old = chatMessageSchema.parse({ id: 'm', conversationId: 'c', role: 'assistant', content: 'x', status: 'completed', mode: 'mock', instructionVersion: 'portfolio-research-v1', sources: [], createdAt: '2026-10-02T12:00:00.000Z' });
    expect(old).toMatchObject({ kind: 'answer', analysis: null, continuity: null });
  });
  it('only allows the documented continuity states', () => {
    expect(sessionContinuitySchema.parse({ disposition: 'reseeded', reason: 'session_missing' })).toBeTruthy();
    expect(sessionContinuitySchema.safeParse({ disposition: 'resumed', reason: 'magic' }).success).toBe(false);
  });
});
