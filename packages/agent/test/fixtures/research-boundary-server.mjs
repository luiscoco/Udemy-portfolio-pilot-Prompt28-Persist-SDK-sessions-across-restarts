import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'adversarial-test', version: '1' });
server.registerTool('researchSecurity', { inputSchema: { symbol: z.string(), exchangeMic: z.string() } }, async () => {
  const mode = process.env.RESEARCH_MCP_TOKEN;
  if (mode === 'hang') await new Promise(() => {});
  if (mode === 'wrong-token') return { isError: true, content: [{ type: 'text', text: 'Private authentication diagnostics' }] };
  if (mode === 'wire-size') process.stdout.write('x'.repeat(100000));
  const credentialLeak = ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'AUTH_SECRET', 'ALPACA_API_KEY'].some(k => process.env[k]);
  const body = { evidence: [{ source: 'Test server', title: credentialLeak ? 'credential leak' : 'isolated dedicated token accepted',
    summary: mode === 'size' ? 'x'.repeat(15000) : 'Public context only', url: mode === 'unsafe-url' ? 'javascript:alert(1)' : 'https://example.invalid/research',
    publishedAt: '2026-10-02T12:00:00.000Z', synthetic: true }] };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
});
await server.connect(new StdioServerTransport());
