import { describe, expect, it, vi } from 'vitest';
import type { query } from '@anthropic-ai/claude-agent-sdk';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentConfigurationError, AgentExecutionError, ClaudePortfolioAgentService, MockPortfolioAgentService } from '../src/index.js';
import { context } from './fixtures.js';

const workspaceDir = join(tmpdir(), 'portfolio-pilot-agent-test-runtime');

describe('agent adapters', () => {
  it('returns a labeled deterministic mock answer', async () => {
    const agent = new MockPortfolioAgentService(context());
    expect(await agent.ask('First question')).toEqual(await agent.ask('Second question'));
    expect((await agent.ask('Question')).answer).toContain('[Mock answer]');
  });
  it('fails before invoking the SDK when the API key is missing', async () => {
    const queryFunction = vi.fn();
    const agent = new ClaudePortfolioAgentService({ tools: context(), apiKey: undefined, modelId: 'configured-test-model', workspaceDir, queryFunction: queryFunction as unknown as typeof query });
    await expect(agent.ask('Question')).rejects.toBeInstanceOf(AgentConfigurationError);
    expect(queryFunction).not.toHaveBeenCalled();
  });
  it('uses the installed query API with no tools and reports adapter failures', async () => {
    const queryFunction = vi.fn(() => (async function* () { throw new Error('SDK failure'); })());
    const agent = new ClaudePortfolioAgentService({ tools: context(), apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir, queryFunction: queryFunction as unknown as typeof query });
    await expect(agent.ask('Question')).rejects.toBeInstanceOf(AgentExecutionError);
    expect(queryFunction).toHaveBeenCalledOnce();
    const call = queryFunction.mock.calls[0]?.[0] as unknown as Parameters<typeof query>[0];
    expect(call.options).toMatchObject({ model: 'configured-test-model', tools: ['Skill'], maxTurns: 6, maxBudgetUsd: 0.1, persistSession: true });
  });
});
