import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { HookInput, query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ClaudePortfolioAgentService, createExternalResearchTool, delegationOptions, enforceReportedUsage, MockPortfolioAgentService,
  reportedResearchUsage, specialistDefinitions, type AgentRunEvent } from '../src/index.js';
import { context } from './fixtures.js';

const frames = () => {
  const messages = JSON.parse(readFileSync(new URL('./fixtures/sdk/no-partials.json', import.meta.url), 'utf8')) as SDKMessage[];
  const result = messages.at(-1)! as Extract<SDKMessage, { type: 'result' }>;
  result.modelUsage = { 'fixture-model': { inputTokens: 240, outputTokens: 80, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.004, contextWindow: 200000, maxOutputTokens: 1000 } };
  return messages;
};
const request = JSON.stringify({ kind: 'untrusted_research_request_data', request: 'Research news and portfolio risk', portfolioId: 'p-growth' });

describe('bounded specialist delegation', () => {
  it('defines separate instructions, minimal tools, no inherited skills or nested delegation', () => {
    const defs = specialistDefinitions(true);
    expect(Object.keys(defs)).toEqual(['news-research', 'portfolio-risk']);
    expect(defs['news-research']!.tools).toEqual(['searchNews', 'getNewsArticle', 'researchExternal'].map(n => `mcp__portfolio__${n}`));
    expect(defs['portfolio-risk']!.tools).toEqual(['getPortfolioSummary', 'listHoldings'].map(n => `mcp__portfolio__${n}`));
    for (const def of Object.values(defs)) expect(def).toMatchObject({ maxTurns: 3, background: false, omitClaudeMd: true, skills: [], model: 'inherit' });
    expect(defs['news-research']!.prompt).not.toBe(defs['portfolio-risk']!.prompt);
  });
  it('policy rejects nesting, unknown agents, repeated launches, role escalation and excessive tool calls', async () => {
    const options = delegationOptions(context());
    const hook = options.hooks!.PreToolUse![0]!.hooks[0]!;
    const invoke = (tool_name: string, tool_input: unknown = {}, extra = {}) => hook({ hook_event_name: 'PreToolUse', session_id: 'session', cwd: '.', transcript_path: '.', tool_use_id: 't', tool_name, tool_input, ...extra } as HookInput, 't', { signal: new AbortController().signal });
    const denied = { hookSpecificOutput: { permissionDecision: 'deny' } };
    expect(await invoke('Agent', { subagent_type: 'general-purpose', prompt: 'Read secrets' })).toMatchObject(denied);
    expect(await invoke('Agent', { subagent_type: 'news-research', prompt: 'Research' }, { agent_id: 'child' })).toMatchObject(denied);
    expect(await invoke('Agent', { subagent_type: 'news-research', prompt: 'Research' })).toMatchObject({ hookSpecificOutput: { updatedInput: { run_in_background: false } } });
    expect(await invoke('Agent', { subagent_type: 'news-research', prompt: 'Again' })).toMatchObject(denied);
    expect(await invoke('mcp__portfolio__listHoldings', {}, { agent_id: 'child', agent_type: 'news-research' })).toMatchObject(denied);
    expect(await invoke('mcp__portfolio__searchNews', {}, { agent_id: 'child', agent_type: 'news-research' })).toEqual({});
    expect(await invoke('Bash')).toMatchObject(denied);
    expect(await invoke('mcp__portfolio__searchNews', {}, { mcp_server: { source: 'project', name: 'portfolio' } })).toMatchObject(denied);
    for (let i = 0; i < 24; i++) await invoke('mcp__portfolio__searchNews');
    expect(await invoke('mcp__portfolio__searchNews')).toMatchObject(denied);
  });
  it('all specialist tools use the same trusted owner-bound port over MCP', async () => {
    const ctx = context();
    const options = delegationOptions(ctx, { mode: 'fixture' });
    const server = options.mcpServers!.portfolio!;
    if (server.type !== 'sdk') throw new Error('Expected SDK server');
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(st);
    const client = new Client({ name: 'delegation-ownership', version: '1' }); await client.connect(ct);
    try {
      for (const [name, args] of [['getPortfolioSummary', { portfolioId: 'foreign' }], ['listHoldings', { portfolioId: 'foreign' }],
        ['searchNews', { portfolioId: 'foreign' }], ['getNewsArticle', { articleId: 'foreign' }], ['researchExternal', { securityId: 'foreign' }]] as const) {
        expect((await client.callTool({ name, arguments: { ...args, userId: 'bob' } })).isError).toBe(true);
      }
      const result = await client.callTool({ name: 'getPortfolioSummary', arguments: { userId: 'bob' } });
      expect(JSON.stringify(result)).toContain('p-growth'); expect(JSON.stringify(result)).not.toContain('bob');
    } finally { await client.close(); await server.instance.close(); }
  });
  it('reports aggregate usage separately and checks caps against nested modelUsage', () => {
    const result = frames().at(-1)! as Extract<SDKMessage, { type: 'result' }>;
    result.modelUsage = { 'test-model': { inputTokens: 700, outputTokens: 100, cacheReadInputTokens: 20, cacheCreationInputTokens: 30, webSearchRequests: 0, costUSD: 0.004, contextWindow: 200000, maxOutputTokens: 1000 } };
    const usage = reportedResearchUsage(result)!;
    expect(usage).toMatchObject({ mainInputTokens: 120, mainOutputTokens: 40, aggregateTokens: 850, costUsd: 0.004 });
    expect(() => enforceReportedUsage(usage, 0.1, 849)).toThrow();
    expect(() => enforceReportedUsage(usage, 0.003, 1000)).toThrow();
    expect(() => enforceReportedUsage(usage, 0.1, 1000)).not.toThrow();
  });
  it('passes native SDK bounds and never emits child text, raw arguments or private data as status', async () => {
    const sequence = frames();
    const child = structuredClone(sequence[1]!) as Extract<SDKMessage, { type: 'assistant' }>;
    child.parent_tool_use_id = 'delegation-1'; child.uuid = '00000000-0000-4000-8000-000000000009'; child.message.id = 'child-message';
    child.message.content = [{ type: 'text', text: 'HIDDEN specialist report' }];
    const closed = vi.fn();
    const queryFunction = vi.fn(() => Object.assign((async function* () { yield child; yield* sequence; })(), { close: closed }));
    const events: AgentRunEvent[] = [];
    const service = new ClaudePortfolioAgentService({ tools: context(), specialists: true, apiKey: 'test', modelId: 'test', workspaceDir: join(tmpdir(), 'portfolio-pilot-m23'), queryFunction: queryFunction as unknown as typeof query });
    expect((await service.stream({ prompt: request, messageId: 'm', onEvent: e => events.push(e) })).text).toBe('Only a completed block.');
    const options = queryFunction.mock.calls[0] as unknown as Parameters<typeof query>;
    expect(options[0].options?.env).toMatchObject({ CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1', CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '2', CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1' });
    expect(JSON.stringify(events)).not.toContain('HIDDEN'); expect(closed).toHaveBeenCalledOnce();
  });
  it('aborts and closes when observed child usage exceeds the aggregate token cap', async () => {
    const sequence = frames(); const closed = vi.fn();
    const queryFunction = () => Object.assign((async function* () { yield* sequence; })(), { close: closed });
    const service = new ClaudePortfolioAgentService({ tools: context(), specialists: true, aggregateTokenLimit: 10, apiKey: 'test', modelId: 'test', workspaceDir: join(tmpdir(), 'portfolio-pilot-m23'), queryFunction: queryFunction as unknown as typeof query });
    await expect(service.stream({ prompt: request, messageId: 'm', onEvent: () => {} })).rejects.toMatchObject({ code: 'error_max_budget_usd' });
    expect(closed).toHaveBeenCalledOnce();
  });
  it('fails closed when a delegated run omits aggregate usage rather than reporting zero nested spend', async () => {
    const sequence = frames(); (sequence.at(-1)! as Extract<SDKMessage, { type: 'result' }>).modelUsage = {};
    const closed = vi.fn(); const queryFunction = () => Object.assign((async function* () { yield* sequence; })(), { close: closed });
    const service = new ClaudePortfolioAgentService({ tools: context(), specialists: true, apiKey: 'test', modelId: 'test', workspaceDir: join(tmpdir(), 'portfolio-pilot-m23'), queryFunction: queryFunction as unknown as typeof query });
    await expect(service.stream({ prompt: request, messageId: 'm', onEvent: () => {} })).rejects.toMatchObject({ code: 'sdk_error' }); expect(closed).toHaveBeenCalledOnce();
  });
  it('compares actual credential-free single/delegated latency and tool calls, with both specialist evidence in the final cited answer', async () => {
    const measurements = [];
    for (const specialists of [false, true]) {
      const ctx = context(); const events: AgentRunEvent[] = []; const start = performance.now();
      const agent = new MockPortfolioAgentService(ctx, { specialists, ...(specialists ? { researchMcp: { mode: 'fixture' as const } } : {}) });
      const result = await agent.stream({ prompt: request, messageId: 'm', onEvent: e => events.push(e) });
      measurements.push({ path: specialists ? 'delegated-fixture' : 'single', latencyMs: Math.round(performance.now() - start), ownerPortCalls: ctx.data.calls.length, modelTokens: 0, costUsd: 0 });
      if (specialists) {
        expect(result.text).toContain('News specialist evidence:'); expect(result.text).toContain('Risk specialist evidence:');
        expect(result.text).toContain('[a1](https://example.invalid/a1)'); expect(result.text).toContain('Optional public research context was retrieved');
        expect(events.filter(e => e.type === 'tool.status' && e.tool === 'delegation' && e.status === 'succeeded')).toHaveLength(2);
        const starts = events.filter(e => e.type === 'tool.status' && e.status === 'started');
        expect(new Set(starts.map(e => e.type === 'tool.status' ? e.toolCallId : '')).size).toBe(starts.length);
      }
    }
    console.log('M23 mock comparison (not live model performance)', JSON.stringify(measurements));
    const directory = new URL('../test-results/', import.meta.url); mkdirSync(directory, { recursive: true });
    writeFileSync(new URL('m23-comparison.json', directory), JSON.stringify({ mode: 'mock-specialist-simulation', measurements }, null, 2));
  });
});

describe('external stdio research boundary', () => {
  const hostileServer = fileURLToPath(new URL('./fixtures/research-boundary-server.mjs', import.meta.url));
  it.each(['hang', 'size', 'wire-size', 'unsafe-url', 'wrong-token'])('bounds and sanitizes %s failures in an actual MCP process', async token => {
    const start = performance.now();
    const definition = createExternalResearchTool(context(), { mode: 'live', scriptPath: hostileServer, token, timeoutMs: 700 });
    const result = await definition.handler({ securityId: 'sec-nova' }, undefined);
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toMatch(/Private authentication|javascript|xxxxx|stack/);
    expect(performance.now() - start).toBeLessThan(3000);
  });
  it('passes only the dedicated MCP credential, without inheriting application secrets', async () => {
    for (const key of ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'AUTH_SECRET', 'ALPACA_API_KEY']) vi.stubEnv(key, 'application-secret-test-marker');
    try {
      const definition = createExternalResearchTool(context(), { mode: 'live', scriptPath: hostileServer, token: 'accepted-dedicated-token' });
      const result = await definition.handler({ securityId: 'sec-nova' }, undefined);
      expect(result.isError).toBeFalsy(); expect(JSON.stringify(result)).toContain('isolated dedicated token accepted');
      expect(JSON.stringify(result)).not.toContain('application-secret-test-marker');
    } finally { vi.unstubAllEnvs(); }
  });
  it('cancels an in-flight external process using the trusted run signal', async () => {
    const controller = new AbortController();
    const definition = createExternalResearchTool({ ...context(), signal: controller.signal }, { mode: 'live', scriptPath: hostileServer, token: 'hang', timeoutMs: 5000 });
    const start = performance.now(); const pending = definition.handler({ securityId: 'sec-nova' }, undefined);
    setTimeout(() => controller.abort(), 100);
    expect((await pending).isError).toBe(true); expect(performance.now() - start).toBeLessThan(2500);
  });
  it('runs the actual fixture MCP transport and caps calls', async () => {
    const definition = createExternalResearchTool(context(), { mode: 'fixture' });
    const call = () => definition.handler({ securityId: 'sec-nova' }, undefined);
    const result = await call(); expect(result.isError).toBeFalsy(); expect(JSON.stringify(result)).toContain('synthetic');
    await call(); expect((await call()).isError).toBe(true);
  });
  it('returns sanitized bounded failure for an unavailable configured live server', async () => {
    const start = performance.now();
    const definition = createExternalResearchTool(context(), { mode: 'live', scriptPath: join(tmpdir(), 'nonexistent-m23-server.js'), token: 'dedicated-test-token', timeoutMs: 250 });
    const result = await definition.handler({ securityId: 'sec-nova' }, undefined);
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toMatch(/token|nonexistent|stack|ENOENT/);
    expect(performance.now() - start).toBeLessThan(2500);
  });
  it('never exports a foreign security, injected server address, or application identity', async () => {
    const ctx = context(); const definition = createExternalResearchTool(ctx, { mode: 'fixture' });
    expect((await definition.handler({ securityId: 'foreign' }, undefined)).isError).toBe(true);
    expect((await definition.handler({ securityId: 'sec-nova', url: 'https://evil.invalid', userId: 'bob' } as never, undefined)).isError).toBe(true);
    expect(ctx.data.calls).toEqual(['listSecurities']);
  });
});
