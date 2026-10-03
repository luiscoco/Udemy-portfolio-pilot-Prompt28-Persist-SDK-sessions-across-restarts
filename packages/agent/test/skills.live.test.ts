import { describe, it, expect } from 'vitest';
import { ClaudePortfolioAgentService, BRIEFING_HEADINGS, type AgentAuditRecord } from '../src/index.js';
import { context } from './fixtures.js';

describe.skipIf(process.env.RUN_LIVE_SKILLS_TEST !== 'true')('live application skill acceptance', () => {
  it('invokes the briefing skill and produces its expected structure with run correlation', async () => {
    const records: AgentAuditRecord[] = [];
    const workspaceDir = process.env.AGENT_WORKSPACE_DIR, modelId = process.env.AGENT_MODEL_ID;
    if (!workspaceDir || !modelId) throw new Error('Supply verified AGENT_MODEL_ID and clean absolute AGENT_WORKSPACE_DIR.');
    const identity = { actorId: 'fixture-alice', conversationId: 'fixture-conversation', runId: 'fixture-live-skill-run' };
    const agent = new ClaudePortfolioAgentService({ tools: context(), apiKey: process.env.ANTHROPIC_API_KEY,
      modelId, workspaceDir, maxTurns: 10, maxBudgetUsd: 0.1, auditSink: record => { records.push(record); } });
    const result = await agent.stream({ prompt: 'Invoke daily-portfolio-briefing and prepare a daily portfolio briefing from the authorized application tools.',
      messageId: 'fixture-message', audit: identity, onEvent: () => {} });
    expect(result.text.match(/^## .+$/gm)).toEqual(BRIEFING_HEADINGS.map(h => `## ${h}`));
    expect(result.text).toContain('Skill used: daily-portfolio-briefing');
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ ...identity, toolName: 'Skill', outcome: 'succeeded', metadata: expect.objectContaining({ skill: 'daily-portfolio-briefing' }) })]));
  }, 70000);
});
