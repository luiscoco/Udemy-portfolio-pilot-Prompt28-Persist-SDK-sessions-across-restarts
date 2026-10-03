import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudePortfolioAgentService, reportedResearchUsage, type AgentStreamInput } from '../src/index.js';
import { context } from './fixtures.js';

const frames = () => JSON.parse(readFileSync(new URL('./fixtures/sdk/no-partials.json', import.meta.url), 'utf8')) as SDKMessage[];
const input = (): AgentStreamInput => ({ prompt: 'Question', messageId: 'app-message', onEvent: () => {}, limits: { promptBytes: 48000, toolResultBytes: 24000, turns: 6, costUsd: 0.1 } });
function agent(messages: SDKMessage[], stall = false) {
  const close = vi.fn();
  const queryFunction = vi.fn(() => Object.assign((async function* () { yield* messages; if (stall) await new Promise(() => {}); })(), { close }));
  return { close, queryFunction, service: new ClaudePortfolioAgentService({ tools: context(), apiKey: 'fixture-only', modelId: 'server-configured-model', workspaceDir: join(tmpdir(), 'portfolio-pilot-m26-runtime'), queryFunction: queryFunction as unknown as typeof query, timeoutMs: 100 }) };
}
describe('documented SDK limits and accounting', () => {
  it('records reported model and whole-tree result totals, ignoring repeated assistant/partial token frames', async () => {
    const messages = frames();
    const assistant = messages.find(m => m.type === 'assistant') as Extract<SDKMessage, { type: 'assistant' }>;
    assistant.message.model = 'resolved-runtime-model';
    messages.splice(2, 0, assistant, assistant);
    const result = messages.at(-1) as Extract<SDKMessage, { type: 'result' }>;
    result.modelUsage = { 'runtime-model': { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 300, cacheCreationInputTokens: 400, webSearchRequests: 0, costUSD: 0.004, contextWindow: 200000, maxOutputTokens: 8000 } };
    const { service, queryFunction } = agent(messages);
    const onUsage = vi.fn(), onModel = vi.fn();
    const answer = await service.stream({ ...input(), onUsage, onModel });
    expect(answer.usage).toMatchObject({ costUsd: 0.004, aggregateTokens: 1000 });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onModel).toHaveBeenCalledWith('recorded-model');
    expect(answer.reportedModel).toBe('resolved-runtime-model');
    expect(queryFunction.mock.calls[0]?.[0]).toMatchObject({ options: { model: 'server-configured-model', maxTurns: 6, maxBudgetUsd: 0.1 } });
  });
  it('blocks oversized UTF-8 prompts before query starts', async () => {
    const { service, queryFunction } = agent(frames());
    await expect(service.stream({ ...input(), prompt: '€'.repeat(20000) })).rejects.toMatchObject({ code: 'prompt_limit' });
    expect(queryFunction).not.toHaveBeenCalled();
  });
  it('enforces main turn limit in the application and closes the SDK query', async () => {
    const messages = frames(), assistant = messages.find(m => m.type === 'assistant') as Extract<SDKMessage, { type: 'assistant' }>;
    messages.splice(2, 0, { ...assistant, uuid: 'extra', message: { ...assistant.message, id: 'second-main-roundtrip' } });
    const { service, close } = agent(messages);
    await expect(service.stream({ ...input(), limits: { ...input().limits!, turns: 1 } })).rejects.toMatchObject({ code: 'error_max_turns' });
    expect(close).toHaveBeenCalledOnce();
  });
  it('collects error-result usage before enforcing the SDK cost cap', async () => {
    const messages = frames(), result = messages.at(-1) as Extract<SDKMessage, { type: 'result' }>;
    result.total_cost_usd = 0.2;
    const { service, close } = agent(messages); const onUsage = vi.fn();
    await expect(service.stream({ ...input(), onUsage })).rejects.toMatchObject({ code: 'error_max_budget_usd' });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0.2 })); expect(close).toHaveBeenCalledOnce();
  });
  it('times out an SDK iterator that ignores abort and closes the process', async () => {
    const { service, close } = agent([], true);
    await expect(service.stream(input())).rejects.toMatchObject({ code: 'timeout' }); expect(close).toHaveBeenCalledOnce();
  });
  it('marks crash results uncertain even if the SDK reports zero', () => {
    const message = { ...frames().at(-1), subtype: 'error_during_execution', total_cost_usd: 0 } as SDKMessage;
    expect(reportedResearchUsage(message)).toMatchObject({ complete: false, costUsd: 0 });
  });
});
