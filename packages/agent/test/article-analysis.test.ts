import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { articleExposure, generateRecommendations, type AnalyzedArticle } from '@portfolio-pilot/domain';
import { AgentRunFailure, analyzeArticle, ClaudeArticleAnalyzer, MockArticleAnalyzer, validateArticleAnalysis, type ArticleAnalysisInput, type ArticleAnalyzer } from '../src/index.js';
import { NOW } from './fixtures.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/research/${name}.json`, import.meta.url), 'utf8'));
const contradictory = fixture('contradictory-articles');
const neutral = fixture('neutral-news');
const input = (a: { key: string; provider: string; title: string; summary: string; publishedHoursAgo?: number; symbols: string[] }): ArticleAnalysisInput => ({
  articleId: `article-${a.key}`, title: a.title, summary: a.summary, url: `https://example.com/mock/${a.key}`, provider: a.provider, isSynthetic: true,
  publishedAt: new Date(NOW.getTime() - (a.publishedHoursAgo ?? 1) * 3600_000).toISOString(), symbols: a.symbols
});
const scripted = (outputs: unknown[]): ArticleAnalyzer & { calls: Array<readonly string[] | undefined> } => {
  const calls: Array<readonly string[] | undefined> = [];
  return { mode: 'claude', modelKey: 'claude:test', calls, async analyze(_input, options) { calls.push(options?.correction); const next = outputs[Math.min(calls.length - 1, outputs.length - 1)]; if (next instanceof Error) throw next; return next; } };
};
const valid = async (i: ArticleAnalysisInput) => new MockArticleAnalyzer().analyze(i);

describe('mock shared article analysis on the research fixtures', () => {
  it('classifies the contradictory pair as opposite, material reporting', async () => {
    for (const article of contradictory.articles) {
      const result = await analyzeArticle(new MockArticleAnalyzer(), input(article));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect({ sentiment: result.analysis.sentiment.label, materiality: result.analysis.materiality, eventCategories: result.analysis.eventCategories, primarySourceRecommended: result.analysis.primarySource.recommended }).toEqual(article.expected);
      expect(result.analysis.sources).toEqual([{ articleId: `article-${article.key}`, url: `https://example.com/mock/${article.key}` }]);
    }
  });

  it('classifies neutral news as neutral and immaterial', async () => {
    const result = await analyzeArticle(new MockArticleAnalyzer(), input(neutral.article));
    expect(result.ok && { sentiment: result.analysis.sentiment.label, materiality: result.analysis.materiality, eventCategories: result.analysis.eventCategories, primarySourceRecommended: result.analysis.primarySource.recommended })
      .toEqual({ sentiment: 'neutral', materiality: 'none', eventCategories: ['other'], primarySourceRecommended: false });
  });

  it('feeds deterministic rules that differ per owner and stay silent for neutral news', async () => {
    const analyzed = async (article: Parameters<typeof input>[0]): Promise<AnalyzedArticle> => {
      const i = input(article); const result = await analyzeArticle(new MockArticleAnalyzer(), i);
      if (!result.ok) throw new Error('fixture analysis failed');
      return { analysisId: `analysis-${article.key}`, articleId: i.articleId, title: i.title, url: i.url, publishedAt: i.publishedAt, revisionKey: '0'.repeat(64), securityIds: ['acme'], analysis: result.analysis };
    };
    const [raise, cut] = [await analyzed(contradictory.articles[0]), await analyzed(contradictory.articles[1])];
    const position = (id: string, value: string) => ({ securityId: id, symbol: id.toUpperCase(), exchangeMic: 'XNAS', remainingQuantity: '1.0000000000', remainingCostBasis: value, marketValue: value, quoteStatus: 'fresh' as const });
    const owner = (acme: string, other: string, watch: string[] = []) => articleExposure({ affectedSecurityIds: ['acme'], portfolios: acme === '0' ? [] : [{ portfolioId: 'p', name: 'P', positions: [position('acme', acme), position('other', other)] }], watchlistSecurityIds: watch });
    const types = (subject: AnalyzedArticle, exposure: ReturnType<typeof articleExposure>) => generateRecommendations({ subject, related: [raise, cut], exposure, securities: [{ securityId: 'acme', symbol: 'ACME' }], asOf: NOW.toISOString() }).map(r => r.type);
    expect(types(cut, owner('500.00', '500.00'))).toEqual(contradictory.expectedRecommendations.concentratedHolderOfCut);
    expect(types(cut, owner('100.00', '900.00'))).toEqual(contradictory.expectedRecommendations.diversifiedHolderOfCut);
    expect(types(cut, owner('0', '0', ['acme']))).toEqual(contradictory.expectedRecommendations.watcherOfCut);
    expect(types(await analyzed(neutral.article), owner('500.00', '500.00'))).toEqual(neutral.expected.recommendations);
  });
});

describe('validateArticleAnalysis', () => {
  const i = input(contradictory.articles[0]);
  it('rejects any source other than the analyzed article', async () => {
    const overrides = fixture('unsupported-source').rawOutputOverrides;
    const sources = overrides.sources.map((s: { articleId: string; url: string }) => ({ articleId: s.articleId.replace('{{articleId}}', i.articleId), url: s.url.replace('{{url}}', i.url) }));
    expect(validateArticleAnalysis({ ...await valid(i), sources }, i)).toEqual({ ok: false, code: 'analysis_unknown_source', issues: ['sources.1.articleId: unsupported source'] });
    expect(validateArticleAnalysis({ ...await valid(i), sources: [{ articleId: i.articleId, url: 'https://example.com/other' }] }, i)).toMatchObject({ code: 'analysis_unknown_source', issues: ['sources.0.url: does not match the article URL'] });
    expect(validateArticleAnalysis({ ...await valid(i), articleId: 'article-cut' }, i)).toMatchObject({ code: 'analysis_unknown_source' });
    expect(validateArticleAnalysis({ ...await valid(i), mentionedSymbols: ['ZETA'] }, i)).toMatchObject({ code: 'analysis_unknown_source', issues: ['mentionedSymbols.0: not linked to the article'] });
  });
  it('rejects prohibited judgments, invalid structure and "high" materiality', async () => {
    const prohibited = fixture('prohibited-content');
    expect(validateArticleAnalysis({ ...await valid(i), ...prohibited.rawOutputOverrides }, i)).toEqual({ ok: false, code: 'analysis_prohibited_content', issues: prohibited.expectedIssues });
    expect(validateArticleAnalysis({ ...await valid(i), materiality: 'high' }, i)).toMatchObject({ ok: false, code: 'analysis_invalid_structure', issues: ['materiality: invalid_value'] });
    expect(validateArticleAnalysis({ ...await valid(i), extra: true }, i)).toMatchObject({ ok: false, code: 'analysis_invalid_structure' });
    expect(validateArticleAnalysis('{"looks":"like json"}', i)).toMatchObject({ ok: false, code: 'analysis_invalid_structure' });
    expect(validateArticleAnalysis({ ...await valid(i), keyFacts: [{ statement: 'The article reports a price target of $999.' }] }, i)).toMatchObject({ ok: false, code: 'analysis_prohibited_content', issues: ['keyFacts.0.statement: price_target'] });
  });
});

describe('analyzeArticle', () => {
  const i = input(contradictory.articles[1]);
  it('retries once with a correction that names only rules, then succeeds', async () => {
    const good = await valid(i);
    const analyzer = scripted([{ ...good, sources: [{ articleId: 'elsewhere', url: 'https://attacker.example/x' }] }, good]);
    const result = await analyzeArticle(analyzer, i);
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(analyzer.calls[0]).toBeUndefined();
    expect(analyzer.calls[1]!.join('\n')).not.toContain('attacker.example');
    expect(analyzer.calls[1]).toContain('sources.0.articleId: unsupported source');
  });
  it('fails with a typed code after the bounded attempts or when there is no output', async () => {
    expect(await analyzeArticle(scripted([{ nope: true }]), i)).toMatchObject({ ok: false, code: 'analysis_invalid_structure', attempts: 2 });
    expect(await analyzeArticle(scripted([new AgentRunFailure('analysis_retries_exhausted')]), i)).toMatchObject({ ok: false, code: 'analysis_no_output', attempts: 1 });
    expect(await analyzeArticle(scripted([new Error('network')]), i)).toMatchObject({ ok: false, code: 'analysis_failed', attempts: 1 });
  });
});

describe('ClaudeArticleAnalyzer', () => {
  const i = input(contradictory.articles[0]);
  const analyzer = (messages: unknown[]) => {
    const queryFunction = vi.fn(() => Object.assign((async function* () { for (const m of messages) yield m; })(), { close: vi.fn() }));
    return { queryFunction, analyzer: new ClaudeArticleAnalyzer({ apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir: join(tmpdir(), 'portfolio-pilot-agent-test-runtime'), queryFunction: queryFunction as unknown as typeof query }) };
  };
  it('runs with no tools, no MCP servers, no session and documented structured output over public article data only', async () => {
    const { queryFunction, analyzer: live } = analyzer([{ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: await valid(i) }]);
    const result = await analyzeArticle(live, i);
    expect(result).toMatchObject({ ok: true, attempts: 1 });
    expect(live.modelKey).toBe('claude:configured-test-model:turns=3:budget=0.05:timeout=45000');
    const { prompt, options } = (queryFunction.mock.calls[0] as unknown as Parameters<typeof query>)[0];
    expect(options).toMatchObject({ tools: [], mcpServers: {}, strictMcpConfig: true, allowedTools: [], persistSession: false, settingSources: [], maxTurns: 3, outputFormat: { type: 'json_schema' } });
    expect(options!.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'WebFetch', 'WebSearch']));
    await expect(options!.canUseTool!('Bash', {}, { signal: new AbortController().signal, toolUseID: 't' } as never)).resolves.toMatchObject({ behavior: 'deny' });
    const data = JSON.parse(prompt as string);
    expect(Object.keys(data.article).sort()).toEqual(['articleId', 'isSynthetic', 'linkedSymbols', 'provider', 'publishedAt', 'summary', 'title', 'url']);
    expect(prompt).not.toMatch(/portfolioId|holding|owner|quantity|weight|watchlist/i);
  });
  it('maps the documented structured-output retry error and a missing output to typed failures', async () => {
    expect(await analyzeArticle(analyzer([{ type: 'result', subtype: 'error_max_structured_output_retries', is_error: true }]).analyzer, i)).toMatchObject({ ok: false, code: 'analysis_no_output' });
    expect(await analyzeArticle(analyzer([{ type: 'result', subtype: 'success', is_error: false, result: 'prose' }]).analyzer, i)).toMatchObject({ ok: false, code: 'analysis_no_output' });
  });
});
