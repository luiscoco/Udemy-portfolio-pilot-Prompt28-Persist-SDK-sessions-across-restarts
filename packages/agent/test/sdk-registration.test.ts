import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ClaudePortfolioAgentService, createPortfolioToolServer, DISALLOWED_BUILT_IN_TOOLS, PORTFOLIO_ALLOWED_TOOLS, PORTFOLIO_SYSTEM_PROMPT, portfolioToolPermissionGuard, portfolioToolQueryOptions } from '../src/index.js';
import { context } from './fixtures.js';

const clients: Client[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); });
async function connect(ctx = context()) {
  const server = createPortfolioToolServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: 'portfolio-tool-test', version: '1.0.0' });
  await client.connect(clientTransport);
  clients.push(client);
  return { server, client };
}

describe('in-process SDK MCP server', () => {
  it('advertises six read-only tools with JSON Schemas that have no identity fields', async () => {
    const { server, client } = await connect();
    expect(server).toMatchObject({ type: 'sdk', name: 'portfolio' });
    expect(client.getInstructions()).toMatch(/never ask for or supply a user ID/);
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['getPortfolioSummary', 'listHoldings', 'listTransactions', 'getQuotes', 'searchNews', 'getNewsArticle']);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(t._meta?.['anthropic/alwaysLoad']).toBe(true);
      const schema = t.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown };
      expect(Object.keys(schema.properties ?? {}).filter(key => /user|owner|account/i.test(key))).toEqual([]);
    }
    const holdings = tools.find(t => t.name === 'listHoldings')!.inputSchema as { required?: string[]; properties: Record<string, { maximum?: number }> };
    expect(holdings.required).toEqual(['portfolioId']);
    expect(holdings.properties.limit!.maximum).toBe(50);
  });
  it('executes tools over the protocol and rejects malformed arguments before the handler', async () => {
    const ctx = context();
    const { client } = await connect(ctx);
    const ok = await client.callTool({ name: 'getQuotes', arguments: { securityIds: ['sec-nova'] } });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as { quotes: Array<{ symbol: string }> }).quotes[0]!.symbol).toBe('NOVA');
    const bad = await client.callTool({ name: 'listHoldings', arguments: { portfolioId: 'p-growth', limit: 5000 } });
    expect(bad.isError).toBe(true);
    expect(ctx.data.calls).toEqual(['listSecurities', 'latestQuotes']);
    const unknown = await client.callTool({ name: 'recordTrade', arguments: {} });
    expect(unknown.isError).toBe(true);
  });
  it('ignores a model-supplied userId on the protocol path: the trusted context still decides the owner', async () => {
    // The SDK wraps raw shapes in a non-strict object, so unknown keys are stripped before the handler
    // (direct invocations are rejected by the strict schema instead). Either way identity cannot change.
    const ctx = context();
    const { client } = await connect(ctx);
    const result = await client.callTool({ name: 'getPortfolioSummary', arguments: { userId: 'demo-bob' } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { portfolios: Array<{ id: string }> }).portfolios.map(p => p.id)).toEqual(['p-growth', 'p-old']);
    expect(ctx.data.calls).toEqual(['listPortfolios', 'getSummary', 'getSummary']);
  });
});

describe('SDK query configuration', () => {
  it('disables built-ins and constrains the run to the six portfolio tools', () => {
    const server = createPortfolioToolServer(context());
    const options = portfolioToolQueryOptions(server);
    expect(options).toMatchObject({ tools: [], strictMcpConfig: true, permissionMode: 'dontAsk', settingSources: [], skills: [], agents: {}, plugins: [] });
    expect(Object.keys(options.mcpServers)).toEqual(['portfolio']);
    expect(options.mcpServers.portfolio).toBe(server);
    expect(options.allowedTools).toEqual(['getPortfolioSummary', 'listHoldings', 'listTransactions', 'getQuotes', 'searchNews', 'getNewsArticle'].map(n => `mcp__portfolio__${n}`));
    expect(options.allowedTools.some(name => name.includes('*'))).toBe(false);
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch']));
    expect(DISALLOWED_BUILT_IN_TOOLS.some(name => PORTFOLIO_ALLOWED_TOOLS.includes(name))).toBe(false);
  });
  it('denies every tool except ours from our in-process server', async () => {
    const signal = new AbortController().signal;
    const decide = (name: string, mcpServer?: { name: string; source: string }) => portfolioToolPermissionGuard(name, {}, { signal, ...(mcpServer ? { mcpServer } : {}) } as Parameters<typeof portfolioToolPermissionGuard>[2]);
    expect(await decide('mcp__portfolio__getQuotes', { name: 'portfolio', source: 'sdk' })).toEqual({ behavior: 'allow' });
    for (const denied of [decide('Bash'), decide('Read'), decide('WebFetch'), decide('mcp__portfolio__recordTrade', { name: 'portfolio', source: 'sdk' }),
      decide('mcp__portfolio__getQuotes', { name: 'portfolio', source: 'project' }), decide('mcp__other__getQuotes', { name: 'other', source: 'sdk' })]) {
      expect(await denied).toMatchObject({ behavior: 'deny' });
    }
  });
  it('passes the constrained configuration to the installed query API', async () => {
    const queryFunction = vi.fn(() => (async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: ' Grounded answer ' }; })());
    const agent = new ClaudePortfolioAgentService({ apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir: join(tmpdir(), 'portfolio-pilot-agent-test-runtime'), tools: context(), queryFunction: queryFunction as unknown as typeof query });
    expect(await agent.ask('What do I own?')).toEqual({ mode: 'claude', answer: 'Grounded answer' });
    const options = (queryFunction.mock.calls[0] as unknown as Parameters<typeof query>)[0].options!;
    expect(options).toMatchObject({ model: 'configured-test-model', tools: ['Skill'], strictMcpConfig: true, permissionMode: 'dontAsk', settingSources: ['user'], persistSession: true, maxTurns: 6, maxBudgetUsd: 0.1, allowedTools: [...PORTFOLIO_ALLOWED_TOOLS, 'Skill'] });
    expect(options.systemPrompt).toContain(PORTFOLIO_SYSTEM_PROMPT);
    expect(options.env).toMatchObject({ ENABLE_TOOL_SEARCH: 'false', ANTHROPIC_API_KEY: 'test-key' });
    expect(options.mcpServers!.portfolio).toMatchObject({ type: 'sdk', name: 'portfolio' });
    expect(typeof options.canUseTool).toBe('function');
  });
});
