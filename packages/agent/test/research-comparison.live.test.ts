import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClaudePortfolioAgentService, type AgentRunEvent, type ResearchUsage } from '../src/index.js';
import { context } from './fixtures.js';

/** Opt-in paid experiment. Fixtures contain only synthetic teaching data; no application credentials are exported. */
describe.skipIf(process.env.RUN_LIVE_RESEARCH_COMPARE !== 'true')('live SDK single/delegated comparison', () => {
  it('records observed aggregate usage and latency; confirms both specialists contributed', async () => {
    const { ANTHROPIC_API_KEY, AGENT_MODEL_ID, AGENT_WORKSPACE_DIR } = process.env;
    if (!ANTHROPIC_API_KEY || !AGENT_MODEL_ID || !AGENT_WORKSPACE_DIR) throw new Error('Provide ANTHROPIC_API_KEY, AGENT_MODEL_ID and isolated AGENT_WORKSPACE_DIR');
    const records = [];
    for (const specialists of [false, true]) {
      let usage: ResearchUsage | undefined; const events: AgentRunEvent[] = []; const start = performance.now();
      const service = new ClaudePortfolioAgentService({ tools: context(), apiKey: ANTHROPIC_API_KEY, modelId: AGENT_MODEL_ID, workspaceDir: AGENT_WORKSPACE_DIR,
        specialists, maxTurns: 10, maxBudgetUsd: 0.1, timeoutMs: 60000, ...(specialists ? { researchMcp: { mode: 'fixture' as const } } : {}), onUsage: u => { usage = u; } });
      const result = await service.stream({ prompt: 'Research stored news for portfolio p-growth and assess its concentration. Cite only articles actually read. ' + (specialists
        ? 'Use news-research and portfolio-risk, one foreground task each. The main agent must combine both reports.' : 'Use the available portfolio tools directly.'), messageId: `compare-${specialists}`, onEvent: e => events.push(e) });
      expect(usage).toBeDefined(); expect(Object.keys(usage!.modelUsage).length).toBeGreaterThan(0);
      if (specialists) {
        expect(events.filter(e => e.type === 'tool.status' && e.tool === 'delegation' && e.status === 'succeeded')).toHaveLength(2);
        expect(usage!.aggregateTokens).toBeGreaterThan(usage!.mainInputTokens + usage!.mainOutputTokens);
      }
      expect(result.text).toMatch(/a1|a2/);
      records.push({ path: specialists ? 'delegated' : 'single', observedWallMs: Math.round(performance.now() - start), usage });
    }
    const directory = new URL('../test-results/', import.meta.url); mkdirSync(directory, { recursive: true });
    writeFileSync(new URL('m23-live-comparison.json', directory), JSON.stringify(records, null, 2));
  }, 150000);
});
