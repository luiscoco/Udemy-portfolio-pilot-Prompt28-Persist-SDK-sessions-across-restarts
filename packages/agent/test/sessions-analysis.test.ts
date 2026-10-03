import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatMessage } from '@portfolio-pilot/contracts';
import {
  AgentRunFailure, analysisCorrection, buildResearchPrompt, ClaudePortfolioAgentService, conversationSeed, createPortfolioTools, localSessionFileExists, MockPortfolioAgentService,
  NEWS_ANALYSIS_OUTPUT_SCHEMA, renderNewsAnalysis, researchContext, SessionResumeError, validateNewsAnalysis, type AgentRunEvent, type PortfolioToolContext
} from '../src/index.js';
import { MockSessionStore } from '../src/mock-portfolio-agent.js';
import { context, NOW } from './fixtures.js';

const analysisFixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/analysis/${name}.json`, import.meta.url), 'utf8')) as unknown;
const sdkFixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/sdk/${name}.json`, import.meta.url), 'utf8')) as SDKMessage[];
const workspaceDir = join(tmpdir(), 'portfolio-pilot-agent-test-runtime');
const SESSION = '5b3f2c1a-8d4e-4f6b-9a7c-2e1d0f9b8a6c';

/** A run that READ the given articles through the authorized tool, so they are known sources. */
async function readArticles(ids: string[]) {
  const run = researchContext(context());
  const tools = createPortfolioTools(run.tools);
  for (const articleId of ids) await tools.find(t => t.name === 'getNewsArticle')!.handler({ articleId } as never, undefined);
  return run;
}
function liveAgent(messages: SDKMessage[] | (() => AsyncGenerator<SDKMessage>), tools: PortfolioToolContext = context()) {
  const queryFunction = vi.fn(() => Object.assign(typeof messages === 'function' ? messages() : (async function* () { yield* messages; })(), { close: vi.fn() }));
  return { queryFunction, agent: new ClaudePortfolioAgentService({ tools, apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir, queryFunction: queryFunction as unknown as typeof query }) };
}
const optionsOf = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[0] as unknown as Parameters<typeof query>)[0].options!;

describe('news-analysis-v1 validation (fixtures)', () => {
  it('accepts a valid analysis whose every reference was read in this run, and takes titles from the tools', async () => {
    const run = await readArticles(['a1', 'a2']);
    const result = validateNewsAnalysis(analysisFixture('valid'), run.evidence(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.articles[0]!.title).toBe('Synthetic headline a1');
    const markdown = renderNewsAnalysis(result.analysis, run.evidence());
    expect(markdown).toContain('### Facts\n\n- Example Wire published');
    expect(markdown).toContain('[a1](https://example.invalid/a1)');
    expect(markdown).not.toContain('invented for a1');
  });
  it('rejects invalid structure with a typed failure that names paths, not model text', async () => {
    const run = await readArticles(['a1']);
    const result = validateNewsAnalysis(analysisFixture('invalid-structure'), run.evidence(), NOW);
    expect(result).toMatchObject({ ok: false, code: 'analysis_invalid_structure' });
    if (result.ok) return;
    expect(result.issues.join('\n')).toMatch(/asOf|uncertainties|confidence|unrecognized_keys/);
    expect(JSON.stringify(result.issues)).not.toMatch(/Certain upside|150\.00|NOVA will rise/);
  });
  it('rejects claims without references and cited articles that are not listed with evidence', async () => {
    const run = await readArticles(['a1', 'a2']);
    const result = validateNewsAnalysis(analysisFixture('missing-references'), run.evidence(), NOW);
    expect(result).toMatchObject({ ok: false, code: 'analysis_missing_references' });
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining(['events.0.articleIds: empty', 'factualSummary.0.articleIds: empty', 'factualSummary.1.articleIds.1: not listed in articles']));
    expect(result.issues.some(i => i.startsWith('uncertainties'))).toBe(false); // uncertainties may concern absent evidence
  });
  it('cannot introduce nonexistent source IDs, foreign URLs or unlinked securities', async () => {
    const run = await readArticles(['a1']);
    const result = validateNewsAnalysis(analysisFixture('unknown-source'), run.evidence(), NOW);
    expect(result).toMatchObject({ ok: false, code: 'analysis_unknown_source' });
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining(['articles.1.articleId: unknown article', 'evidence.0.url: does not match the article URL', 'affectedSecurities.0.securityId: not linked to the cited article']));
    expect(JSON.stringify(result.issues)).not.toContain('invented-article-77');
  });
  it('treats an article the run did not read as unknown, even if it exists in the store', async () => {
    const run = await readArticles(['a1']); // a2 exists but was not read in this run
    expect(validateNewsAnalysis(analysisFixture('valid'), run.evidence(), NOW)).toMatchObject({ ok: false, code: 'analysis_unknown_source' });
    expect(validateNewsAnalysis(analysisFixture('valid'), new Map(), NOW)).toMatchObject({ ok: false, code: 'analysis_unknown_source' });
  });
  it('rejects an as-of time before a cited article or in the future', async () => {
    const run = await readArticles(['a1', 'a2']);
    const early = { ...(analysisFixture('valid') as object), asOf: '2026-10-02T11:00:00.000Z' };
    expect(validateNewsAnalysis(early, run.evidence(), NOW)).toMatchObject({ ok: false, code: 'analysis_invalid_structure', issues: ['articles.0.publishedAt: after asOf'] });
    const future = { ...(analysisFixture('valid') as object), asOf: '2026-10-03T12:00:00.000Z' };
    expect(validateNewsAnalysis(future, run.evidence(), NOW)).toMatchObject({ ok: false, issues: ['asOf: in the future'] });
  });
  it('never parses strings or casts: non-object output is a structure failure', () => {
    for (const raw of [undefined, null, '{"schemaVersion":"news-analysis-v1"}', 42, []]) expect(validateNewsAnalysis(raw, new Map(), NOW)).toMatchObject({ ok: false, code: 'analysis_invalid_structure' });
  });
  it('exposes a draft-07 JSON Schema with no certainty or extra properties, and a path-only correction', async () => {
    expect(NEWS_ANALYSIS_OUTPUT_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(NEWS_ANALYSIS_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(JSON.stringify(NEWS_ANALYSIS_OUTPUT_SCHEMA)).not.toContain('"high"');
    const run = await readArticles(['a1']);
    const failed = validateNewsAnalysis(analysisFixture('unknown-source'), run.evidence(), NOW);
    if (failed.ok) throw new Error('expected failure');
    const correction = analysisCorrection(failed);
    expect(correction[0]).toContain('analysis_unknown_source');
    expect(correction.join('\n')).not.toMatch(/invented-article-77|attacker\.example|record revenue/);
  });
});

describe('live adapter: documented session and structured-output options (fake query)', () => {
  it('resumes the recorded session with `resume` (never `continue`) and reports the session ID', async () => {
    const { agent, queryFunction } = liveAgent(sdkFixture('resumed-follow-up'));
    const result = await agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {}, resumeSessionId: SESSION });
    expect(result).toMatchObject({ mode: 'claude', text: 'Following up on a1: the review is still scheduled.', sessionId: SESSION, reportedModel: 'recorded-model', usage: { costUsd: 0.006, turns: 3 } });
    expect(optionsOf(queryFunction)).toMatchObject({ resume: SESSION, persistSession: true });
    expect(optionsOf(queryFunction)).not.toHaveProperty('continue');
    expect(optionsOf(queryFunction)).not.toHaveProperty('forkSession');
  });
  it('turns a resume that fails before any output into SessionResumeError without leaking diagnostics', async () => {
    const { agent } = liveAgent(sdkFixture('session-resume-failed'));
    const error = await agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {}, resumeSessionId: '0f0e0d0c-0000-4000-8000-00000000dead' }).catch(e => e as Error);
    expect(error).toBeInstanceOf(SessionResumeError);
    expect(error.message).not.toMatch(/srv|secret|No conversation/);
    // The same failure without a resume is an ordinary typed failure.
    const plain = await liveAgent(sdkFixture('session-resume-failed')).agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {} }).catch(e => e as AgentRunFailure);
    expect(plain).not.toBeInstanceOf(SessionResumeError);
    expect(plain.code).toBe('error_during_execution');
  });
  it('does not treat a failure after visible output as a resumable-session failure', async () => {
    const { agent } = liveAgent(async function* () { yield* sdkFixture('partial-plus-final').slice(0, 5); throw new Error('connection reset'); });
    const events: AgentRunEvent[] = [];
    const error = await agent.stream({ prompt: 'q', messageId: 'm', onEvent: e => events.push(e), resumeSessionId: SESSION }).catch(e => e as AgentRunFailure);
    expect(events.some(e => e.type === 'text.delta')).toBe(true);
    expect(error).not.toBeInstanceOf(SessionResumeError);
    expect(error.code).toBe('sdk_error');
  });
  it('rejects a malformed stored session ID before calling the SDK', async () => {
    const { agent, queryFunction } = liveAgent(sdkFixture('resumed-follow-up'));
    await expect(agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {}, resumeSessionId: '../../etc/passwd' })).rejects.toBeInstanceOf(SessionResumeError);
    expect(queryFunction).not.toHaveBeenCalled();
  });
  it('requests documented outputFormat, hides unvalidated prose and returns raw structured_output', async () => {
    const { agent, queryFunction } = liveAgent(sdkFixture('structured-output'));
    const events: AgentRunEvent[] = [];
    const result = await agent.stream({ prompt: 'q', messageId: 'm', onEvent: e => events.push(e), outputSchema: NEWS_ANALYSIS_OUTPUT_SCHEMA });
    expect(optionsOf(queryFunction).outputFormat).toEqual({ type: 'json_schema', schema: NEWS_ANALYSIS_OUTPUT_SCHEMA });
    expect(result).toMatchObject({ mode: 'claude', text: '', sessionId: SESSION, structuredOutput: analysisFixture('valid'), reportedModel: 'recorded-model', usage: { costUsd: 0.006, turns: 3 } });
    expect(result.structuredOutput).toEqual(analysisFixture('valid'));
    expect(events.filter(e => e.type !== 'tool.status')).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('Draft prose');
  });
  it('maps error_max_structured_output_retries to a typed failure, whether the iterator ends or throws', async () => {
    const ended = await liveAgent(sdkFixture('structured-retries-exhausted')).agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {}, outputSchema: NEWS_ANALYSIS_OUTPUT_SCHEMA }).catch(e => e as AgentRunFailure);
    expect(ended.code).toBe('analysis_retries_exhausted');
    expect(ended.message).not.toMatch(/sk-ant|priceTarget/);
    // A single-shot query() throws after yielding the error result; the result's code still wins.
    const thrown = await liveAgent(async function* () { yield* sdkFixture('structured-retries-exhausted'); throw new Error('Claude Code process exited with code 1'); })
      .agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {}, outputSchema: NEWS_ANALYSIS_OUTPUT_SCHEMA }).catch(e => e as AgentRunFailure);
    expect(thrown.code).toBe('analysis_retries_exhausted');
  });
  it('reports success without structured_output as analysis_no_output', async () => {
    const { agent } = liveAgent(sdkFixture('resumed-follow-up'));
    await expect(agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {}, outputSchema: NEWS_ANALYSIS_OUTPUT_SCHEMA })).rejects.toMatchObject({ code: 'analysis_no_output' });
  });
});

describe('local SDK session files', () => {
  it('finds a transcript only at the documented location, non-empty, for a UUID', async () => {
    const config = await mkdtemp(join(tmpdir(), 'pp-sessions-'));
    await mkdir(join(config, 'projects', '-srv-workspace'), { recursive: true });
    await writeFile(join(config, 'projects', '-srv-workspace', `${SESSION}.jsonl`), '{"type":"user"}\n');
    await writeFile(join(config, 'projects', '-srv-workspace', '11111111-1111-4111-8111-111111111111.jsonl'), '');
    expect(await localSessionFileExists(config, SESSION)).toBe(true);
    expect(await localSessionFileExists(config, '11111111-1111-4111-8111-111111111111')).toBe(false); // empty
    expect(await localSessionFileExists(config, '22222222-2222-4222-8222-222222222222')).toBe(false); // missing
    expect(await localSessionFileExists(config, '../-srv-workspace/' + SESSION)).toBe(false); // not a UUID
    expect(await localSessionFileExists(join(config, 'nope'), SESSION)).toBe(false);
  });
  it('exposes a stable host key bound to this workspace', async () => {
    const { agent } = liveAgent([]);
    const a = await agent.sessions(), b = await agent.sessions();
    expect(a.hostKey).toMatch(/^local:[0-9a-f]{40}$/);
    expect(a.hostKey).toBe(b.hostKey);
    expect(a.modelKey).toBe('claude:configured-test-model:skills-policy-v1');
    expect(await a.isAvailable(SESSION)).toBe(false);
  });
});

describe('mock sessions, follow-ups and analysis', () => {
  const history = (sources: ChatMessage['sources']): ChatMessage[] => [
    { id: 'u1', conversationId: 'c', role: 'user', content: 'Any news?', status: 'completed', mode: null, instructionVersion: null, sources: [], createdAt: NOW.toISOString(), kind: 'answer', analysis: null, continuity: null },
    { id: 'a1m', conversationId: 'c', role: 'assistant', content: 'Earlier answer', status: 'completed', mode: 'mock', instructionVersion: 'portfolio-research-v2', sources, createdAt: NOW.toISOString(), kind: 'answer', analysis: null, continuity: null }];

  it('answers a follow-up in the SAME session from what that session cited', async () => {
    const store = new MockSessionStore();
    const run1 = researchContext(context());
    const agent1 = new MockPortfolioAgentService(run1.tools, { sessionStore: store });
    const first = await agent1.stream({ prompt: await buildResearchPrompt(run1.tools, { portfolioId: null, content: 'Any recent news?', continuity: 'new' }), messageId: 'm1', onEvent: () => {} });
    expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const run2 = researchContext(context());
    const events: AgentRunEvent[] = [];
    const follow = await new MockPortfolioAgentService(run2.tools, { sessionStore: store }).stream({ prompt: await buildResearchPrompt(run2.tools, { portfolioId: null, content: 'Tell me more about the second cited article', continuity: 'resumed' }),
      messageId: 'm2', onEvent: e => events.push(e), resumeSessionId: first.sessionId });
    expect(follow.sessionId).toBe(first.sessionId);
    expect(follow.text).toContain('remembered by this session');
    expect(follow.text).toContain('[a2](https://example.invalid/a2)');
    expect(events.filter(e => e.type === 'tool.status').map(e => e.type === 'tool.status' && e.tool)).toEqual(['getNewsArticle', 'getNewsArticle']);
    expect(run2.sources().map(s => s.articleId)).toEqual(['a2']);
  });
  it('fails a resume of a session this process does not hold before emitting anything', async () => {
    const events: AgentRunEvent[] = [];
    await expect(new MockPortfolioAgentService(context(), { sessionStore: new MockSessionStore() }).stream({ prompt: 'q', messageId: 'm', onEvent: e => events.push(e), resumeSessionId: SESSION })).rejects.toBeInstanceOf(SessionResumeError);
    expect(events).toEqual([]);
  });
  it('a reseeded session knows earlier sources only from the authorized summary, and says so', async () => {
    const seed = conversationSeed(history([{ articleId: 'a1', title: 'Synthetic headline a1', url: 'https://example.invalid/a1', publishedAt: NOW.toISOString(), isSynthetic: true }]));
    const run = researchContext(context());
    const prompt = await buildResearchPrompt(run.tools, { portfolioId: null, content: 'Tell me more about that article', continuity: 'reseeded', seed });
    expect(JSON.parse(prompt)).toMatchObject({ continuity: 'reseeded', seed: { kind: 'application_summary', citedSources: [{ articleId: 'a1' }] } });
    expect(JSON.parse(prompt)).not.toHaveProperty('history');
    const result = await new MockPortfolioAgentService(run.tools, { sessionStore: new MockSessionStore() }).stream({ prompt, messageId: 'm', onEvent: () => {} });
    expect(result.text).toContain('from the application summary of earlier turns');
    expect(result.text).toContain('[a1](https://example.invalid/a1)');
  });
  it('asks instead of guessing when a follow-up has nothing to refer to', async () => {
    const run = researchContext(context());
    const result = await new MockPortfolioAgentService(run.tools, { sessionStore: new MockSessionStore() }).stream({ prompt: await buildResearchPrompt(run.tools, { portfolioId: null, content: 'Tell me more about that article', continuity: 'new' }), messageId: 'm', onEvent: () => {} });
    expect(result.text).toContain('Which article or holding do you mean?');
    expect(run.sources()).toEqual([]);
  });
  it('produces a structured analysis that passes server validation against its own reads', async () => {
    const run = researchContext(context());
    const result = await new MockPortfolioAgentService(run.tools, { sessionStore: new MockSessionStore() }).stream({ prompt: await buildResearchPrompt(run.tools, { portfolioId: null, content: 'Analyze recent news', kind: 'news_analysis', continuity: 'new' }), messageId: 'm', onEvent: () => {}, outputSchema: NEWS_ANALYSIS_OUTPUT_SCHEMA });
    expect(result.text).toBe('');
    const verdict = validateNewsAnalysis(result.structuredOutput, run.evidence(), NOW);
    expect(verdict).toMatchObject({ ok: true, analysis: { articles: [{ articleId: 'a1' }, { articleId: 'a2' }], affectedSecurities: [{ symbol: 'NOVA', relation: 'held' }] } });
  });
  it('bounds the seed summary and returns null without completed turns', () => {
    expect(conversationSeed([])).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({ ...history([])[i % 2]!, id: String(i), content: 'y'.repeat(1500) }));
    const seed = conversationSeed(many)!;
    expect(seed.turns).toHaveLength(8);
    expect(seed.earlierTurnsOmitted).toBe(4);
    expect(seed.turns.every(t => t.content.length === 1000)).toBe(true);
  });
});
