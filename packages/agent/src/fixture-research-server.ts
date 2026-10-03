import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fixture-research', version: '1.0.0' });
server.registerTool('researchSecurity', { description: 'Synthetic public research fixture.',
  inputSchema: { symbol: z.string().regex(/^[A-Z0-9.\-]{1,20}$/), exchangeMic: z.string().regex(/^[A-Z0-9]{4}$/) } }, async ({ symbol }) => {
    const result = { evidence: [{ source: 'PortfolioPilot teaching fixture', title: `${symbol}: synthetic research context`,
      summary: 'Fictional industry context for a repeatable lesson. This is not market evidence or a forecast.',
      publishedAt: '2026-10-02T12:00:00.000Z', url: 'https://example.invalid/research', synthetic: true }] };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  });
await server.connect(new StdioServerTransport());
