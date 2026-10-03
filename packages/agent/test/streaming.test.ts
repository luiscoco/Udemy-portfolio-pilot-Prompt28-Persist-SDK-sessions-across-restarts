import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentCancelledError, AgentRunFailure, ClaudePortfolioAgentService, MockPortfolioAgentService, SdkStreamMapper, type AgentRunEvent } from '../src/index.js';
import { textChunks } from '../src/mock-portfolio-agent.js';
import { context } from './fixtures.js';

/** Recorded SDK message sequences (shaped on the installed 0.3.276 types; see fixtures/sdk/README.md). */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/sdk/${name}.json`, import.meta.url), 'utf8')) as SDKMessage[];
function replay(name: string) {
  const events: AgentRunEvent[] = [];
  const mapper = new SdkStreamMapper('msg-app', e => events.push(e));
  for (const message of fixture(name)) mapper.accept(message);
  let text: string | undefined; let error: unknown;
  try { text = mapper.finish(); } catch (e) { error = e; }
  return { events, text, error };
}
/** What a client renders: deltas build drafts, a completed block REPLACES its draft exactly once. */
function render(events: AgentRunEvent[]) {
  const blocks = new Map<string, { text: string; done: boolean }>();
  for (const e of events) {
    if (e.type === 'text.delta') { const b = blocks.get(e.blockId) ?? { text: '', done: false }; if (!b.done) b.text += e.text; blocks.set(e.blockId, b); }
    if (e.type === 'block.completed') blocks.set(e.blockId, { text: e.text, done: true });
  }
  return [...blocks.values()].map(b => b.text).join('\n\n');
}
const workspaceDir = join(tmpdir(), 'portfolio-pilot-agent-test-runtime');

describe('SDK stream mapping to application events', () => {
  it('reconciles partial deltas with the final block and result exactly once', () => {
    const { events, text } = replay('partial-plus-final');
    expect(events.filter(e => e.type === 'text.delta').map(e => e.type === 'text.delta' && e.text).join('')).toBe('Your largest holding is ACME at 1125.00 USD.');
    expect(events.filter(e => e.type === 'block.completed')).toEqual([{ type: 'block.completed', blockId: 'msg-app.b0', text: 'Your largest holding is ACME at 1125.00 USD.' }]);
    expect(text).toBe('Your largest holding is ACME at 1125.00 USD.');
    // The duplicate-text bug: appending the completed message (or result) after its deltas.
    expect(render(events)).toBe(text);
    expect(render(events).match(/Your largest/g)).toHaveLength(1);
  });
  it('keeps text from several turns, reports sanitized tool progress and never streams arguments or thinking', () => {
    const { events, text } = replay('tool-then-answer');
    expect(text).toBe('I will check your holdings.\n\nFacts: ACME is your largest holding at 1125.00 USD.');
    expect(render(events)).toBe(text);
    expect(events.filter(e => e.type === 'tool.status')).toEqual([
      { type: 'tool.status', toolCallId: 'msg-app.t0', tool: 'listHoldings', status: 'started' },
      { type: 'tool.status', toolCallId: 'msg-app.t0', tool: 'listHoldings', status: 'running' },
      { type: 'tool.status', toolCallId: 'msg-app.t0', tool: 'listHoldings', status: 'succeeded' }
    ]);
    expect(new Set(events.filter(e => e.type !== 'tool.status').map(e => 'blockId' in e && e.blockId))).toEqual(new Set(['msg-app.b0', 'msg-app.b1']));
    expect(JSON.stringify(events)).not.toMatch(/HIDDEN REASONING|p-secret|demo-bob|userId|toolu_|msg_0|mcp__|raw tool output|1125\.00","owner/);
  });
  it('maps a tool-only step without inventing empty text and reports the failed tool', () => {
    const { events, text } = replay('tool-only-step');
    expect(events[0]).toEqual({ type: 'tool.status', toolCallId: 'msg-app.t0', tool: 'searchNews', status: 'started' });
    expect(events[1]).toEqual({ type: 'tool.status', toolCallId: 'msg-app.t0', tool: 'searchNews', status: 'failed' });
    expect(events.filter(e => e.type === 'block.completed')).toHaveLength(1);
    expect(text).toBe('News is unavailable right now; no articles were retrieved.');
  });
  it('turns SDK errors into a fixed failure code without diagnostics', () => {
    const { error } = replay('error-result');
    expect(error).toBeInstanceOf(AgentRunFailure);
    expect((error as AgentRunFailure).code).toBe('error_during_execution');
    expect(String((error as Error).message)).not.toMatch(/sk-ant|ANTHROPIC|stack|srv/);
  });
  it('ignores duplicate frames, subagent transcripts and deltas after completion; authoritative text wins', () => {
    const { events, text } = replay('duplicate-delivery');
    expect(events.filter(e => e.type === 'block.completed')).toHaveLength(1);
    expect(text).toBe('Authoritative: ACME 1125.00 USD.');
    expect(render(events)).toBe(text);
    expect(JSON.stringify(events)).not.toMatch(/Subagent|late duplicate/);
  });
  it('announces a block that was never streamed only by its completion', () => {
    const { events, text } = replay('no-partials');
    expect(events).toEqual([{ type: 'block.completed', blockId: 'msg-app.b0', text: 'Only a completed block.' }]);
    expect(text).toBe('Only a completed block.');
  });
  it('fails over-long answers and runs without a result', () => {
    const mapper = new SdkStreamMapper('m', () => {});
    expect(() => mapper.finish()).toThrow(AgentRunFailure);
    const long = new SdkStreamMapper('m', () => {});
    const big = 'x'.repeat(16001);
    expect(() => long.accept({ type: 'assistant', uuid: 'u', session_id: 's', parent_tool_use_id: null, message: { id: 'a', content: [{ type: 'text', text: big }] } } as unknown as SDKMessage)).toThrow('answer_too_long');
  });
});

describe('live adapter streaming and cancellation (fake query, no credentials)', () => {
  it('passes includePartialMessages and maps the recorded stream', async () => {
    const close = vi.fn();
    const queryFunction = vi.fn(() => Object.assign((async function* () { yield* fixture('partial-plus-final'); })(), { close }));
    const agent = new ClaudePortfolioAgentService({ tools: context(), apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir, queryFunction: queryFunction as unknown as typeof query });
    const events: AgentRunEvent[] = [];
    const result = await agent.stream({ prompt: 'q', messageId: 'm1', onEvent: e => events.push(e) });
    expect(result).toMatchObject({ mode: 'claude', text: 'Your largest holding is ACME at 1125.00 USD.', sessionId: '6a1c0b9e-0000-4000-8000-00000000f19a', reportedModel: 'recorded-model', usage: { costUsd: 0.004, turns: 2 } });
    const options = (queryFunction.mock.calls[0] as unknown as [Parameters<typeof query>[0]])[0].options!;
    expect(options).toMatchObject({ includePartialMessages: true, tools: ['Skill'], persistSession: true });
    expect(options).not.toHaveProperty('resume');
    expect(options).not.toHaveProperty('continue');
    expect(options.abortController?.signal.aborted).toBe(true); // released after completion
    expect(close).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: 'block.completed', blockId: 'm1.b0' });
  });
  it('cancels through the documented abortController, closes the query and reports cancellation', async () => {
    const close = vi.fn();
    let sdkSignal: AbortSignal | undefined;
    const queryFunction = vi.fn((params: Parameters<typeof query>[0]) => {
      sdkSignal = params.options!.abortController!.signal;
      return Object.assign((async function* () {
        yield* fixture('partial-plus-final').slice(0, 4);
        // A stubborn iterator that never ends on abort: the adapter must not wait for it.
        await new Promise(() => {});
        throw Object.assign(new Error('AbortError: internal details'), { name: 'AbortError' });
      })(), { close });
    });
    const agent = new ClaudePortfolioAgentService({ tools: context(), apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir, queryFunction: queryFunction as unknown as typeof query });
    const controller = new AbortController();
    const events: AgentRunEvent[] = [];
    const running = agent.stream({ prompt: 'q', messageId: 'm1', signal: controller.signal, onEvent: e => { events.push(e); if (e.type === 'text.delta') controller.abort(); } });
    await expect(running).rejects.toBeInstanceOf(AgentCancelledError);
    expect(sdkSignal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(events.some(e => e.type === 'block.completed')).toBe(false);
  });
  it('sanitizes thrown SDK errors', async () => {
    const queryFunction = vi.fn(() => Object.assign((async function* () { throw new Error('socket hang up ANTHROPIC_API_KEY=sk-ant-secret'); })(), { close: vi.fn() }));
    const agent = new ClaudePortfolioAgentService({ tools: context(), apiKey: 'test-key', modelId: 'configured-test-model', workspaceDir, queryFunction: queryFunction as unknown as typeof query });
    const error = await agent.stream({ prompt: 'q', messageId: 'm', onEvent: () => {} }).catch(e => e as AgentRunFailure);
    expect(error).toBeInstanceOf(AgentRunFailure);
    expect(error.code).toBe('sdk_error');
    expect(error.message).not.toMatch(/sk-ant|socket/);
  });
});

describe('mock streaming adapter', () => {
  it('streams tool progress and word chunks, then one authoritative block equal to the answer', async () => {
    const agent = new MockPortfolioAgentService(context(), { chunkChars: 16 });
    const events: AgentRunEvent[] = [];
    const result = await agent.stream({ prompt: 'Summarize my portfolio', messageId: 'm', onEvent: e => events.push(e) });
    expect(events[0]).toMatchObject({ type: 'tool.status', tool: 'getPortfolioSummary', status: 'started' });
    expect(events.filter(e => e.type === 'text.delta').length).toBeGreaterThan(3);
    expect(events.at(-1)).toEqual({ type: 'block.completed', blockId: 'm.b0', text: result.text });
    expect(render(events)).toBe(result.text);
    expect(result.text).toBe((await agent.ask('Summarize my portfolio')).answer);
  });
  it('stops at the next chunk when its signal aborts', async () => {
    const controller = new AbortController();
    const agent = new MockPortfolioAgentService(context(), { streamDelayMs: 5, chunkChars: 8 });
    const deltas: string[] = [];
    await expect(agent.stream({ prompt: 'Summarize my portfolio', messageId: 'm', signal: controller.signal, onEvent: e => { if (e.type === 'text.delta') { deltas.push(e.text); if (deltas.length === 2) controller.abort(); } } }))
      .rejects.toBeInstanceOf(AgentCancelledError);
    expect(deltas).toHaveLength(2);
  });
  it('splits on word boundaries without losing characters', () => {
    const text = 'Alpha beta gamma delta epsilon zeta';
    expect(textChunks(text, 7).join('')).toBe(text);
    expect(textChunks(text, 7).every(c => c.length <= 7)).toBe(true);
  });
});
