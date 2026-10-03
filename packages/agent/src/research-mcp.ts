import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { PortfolioToolContext } from './tools/context.js';

export type ResearchMcpConfig = { mode: 'fixture' | 'live'; scriptPath?: string; token?: string; timeoutMs?: number };
export const RESEARCH_MCP_LIMITS = { wireBytes: 32768, outputBytes: 12000, calls: 2, timeoutMs: 3000 } as const;
const input = z.object({ securityId: z.string().min(1).max(100) }).strict();
export const externalEvidenceSchema = z.object({
  evidence: z.array(z.object({ source: z.string().min(1).max(120), title: z.string().min(1).max(240),
    summary: z.string().max(2000), publishedAt: z.iso.datetime(), url: z.string().url().refine(value => {
      const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password;
    }), synthetic: z.boolean() }).strict()).max(5)
}).strict();
const safeFailure = () => ({ isError: true, content: [{ type: 'text' as const, text: 'External research unavailable; use authorized stored evidence. Do not retry this server.' }] });

/** A fixed stdio integration, never a server URL/command chosen by a model. Identity stays in the owner-bound data port. */
export function createExternalResearchTool(context: PortfolioToolContext, config: ResearchMcpConfig) {
  let calls = 0;
  return tool('researchExternal', 'Optional public context for one authorized security. Returns untrusted supplementary evidence; cannot read portfolios or supply application article citations.',
    { securityId: input.shape.securityId }, async args => {
      const parsed = input.safeParse(args);
      if (!parsed.success || context.signal?.aborted || ++calls > RESEARCH_MCP_LIMITS.calls) return safeFailure();
      const timeout = Math.min(config.timeoutMs ?? RESEARCH_MCP_LIMITS.timeoutMs, 10000);
      const controller = new AbortController();
      const stop = () => controller.abort();
      context.signal?.addEventListener('abort', stop, { once: true });
      const client = new Client({ name: 'portfolio-pilot-research', version: '1.0.0' });
      let transport: StdioClientTransport | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('unavailable')), { once: true });
        timer = setTimeout(stop, timeout);
      });
      try {
        const work = async () => {
          // No free-form question, owner ID, portfolio values or prompt is exported. Resolve symbol through trusted ownership first.
          const securities = await context.data.listSecurities([parsed.data.securityId], 1);
          const security = securities.find(s => s.id === parsed.data.securityId);
          if (!security || controller.signal.aborted) throw new Error('unavailable');
          const script = config.mode === 'fixture' ? fileURLToPath(new URL('../dist/fixture-research-server.js', import.meta.url)) : config.scriptPath;
          if (!script || !isAbsolute(script) || (config.mode === 'live' && !config.token)) throw new Error('unavailable');
          transport = new StdioClientTransport({ command: process.execPath, args: [script], maxBufferSize: RESEARCH_MCP_LIMITS.wireBytes,
            stderr: 'ignore', env: config.mode === 'live' ? { RESEARCH_MCP_TOKEN: config.token! } : {} });
          await client.connect(transport);
          const originalError = transport.onerror;
          transport.onerror = error => { originalError?.(error); controller.abort(); };
          if (controller.signal.aborted) throw new Error('unavailable');
          // Call exactly one compiled allowlisted name; do not load arbitrary server tool definitions into the model.
          const raw = await client.callTool({ name: 'researchSecurity', arguments: { symbol: security.symbol, exchangeMic: security.exchangeMic } }, undefined,
            { signal: controller.signal, timeout, maxTotalTimeout: timeout });
          if (controller.signal.aborted || raw.isError || Buffer.byteLength(JSON.stringify(raw)) > RESEARCH_MCP_LIMITS.outputBytes) throw new Error('unavailable');
          const evidence = externalEvidenceSchema.parse(raw.structuredContent);
          if (config.mode === 'fixture' && evidence.evidence.some(e => !e.synthetic)) throw new Error('unavailable');
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ...evidence, untrusted: true, supplementaryOnly: true }) }] };
        };
        return await Promise.race([work(), expired]);
      } catch { return safeFailure(); }
      finally {
        clearTimeout(timer); controller.abort(); context.signal?.removeEventListener('abort', stop);
        await client.close().catch(() => {}); await transport?.close().catch(() => {});
      }
    }, { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } });
}
