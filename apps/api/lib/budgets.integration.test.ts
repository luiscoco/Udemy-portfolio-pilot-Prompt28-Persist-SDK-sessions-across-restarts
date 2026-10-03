import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticateOwner, chatService, closeConnections, createCache, getDatabase, type RunOutcome } from '@portfolio-pilot/db';
import { MockPortfolioAgentService, PORTFOLIO_INSTRUCTION_VERSION, type AgentRunResult, type AgentStreamInput } from '@portfolio-pilot/agent';
import { portfolioToolContext } from './agent-tools';
import { startChatRun, cancelChatRun, reconcileStaleRuns, type AgentFactory } from './testing/worker-harness';
import { testChat, leaseTestRun } from './testing/worker-harness';
import { LocalRunCoordinator } from './testing/local-coordinator';
import type { AppEvent } from '@portfolio-pilot/contracts';

const url = process.env.BUDGET_TEST_DATABASE_URL;
const terminal = (cost = '0.050000'): RunOutcome => ({ status: 'completed', failureCode: null, content: 'Fixture answer', mode: 'claude', instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, sources: [],
  usage: { accounting: 'sdk_estimate', estimatedCostUsd: cost, aggregateTokens: 100, turns: 1, resultCount: 1 } });
const usage = (costUsd: number) => ({ complete: true, costUsd, turns: 1, mainInputTokens: 20, mainOutputTokens: 10, aggregateTokens: 999, durationMs: 10, apiDurationMs: 8, modelUsage: {} });
function fakeAgent(work: (input: AgentStreamInput) => Promise<AgentRunResult>): AgentFactory {
  return () => ({ sessions: async () => ({ hostKey: 'fixture', modelKey: 'fixture', isAvailable: async () => true }), stream: work });
}

describe.skipIf(!url)('milestone 26 PostgreSQL reservations and terminal limits', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  const owners: string[] = [];
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || !['/portfolio_m26_verify','/portfolio_m27_verify'].includes(parsed.pathname)) throw new Error('Use the dedicated loopback portfolio_m26_verify DB.');
    db = await getDatabase(url!);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { if (db) await db.user.deleteMany({ where: { id: { in: owners } } }); await closeConnections(); });
  async function fixture() {
    const id = 'budget-' + randomUUID(); owners.push(id);
    await db.user.create({ data: { id, name: 'Budget test', email: `${id}@example.invalid` } });
    await db.session.create({ data: { id, userId: id, token: id, expiresAt: new Date(Date.now() + 600000) } });
    const owner = await authenticateOwner(db, id);
    const chat = testChat(db, chatService(db, owner));
    const conversation = await chat.create({});
    await db.portfolio.create({ data: { ownerId: id, name: 'Budget test portfolio' } });
    const tools = portfolioToolContext(db, createCache({ namespace: 'budget-test', redis: async () => null }), owner, 'mock');
    return { id, chat, conversation, tools };
  }
  const ledger = (id: string) => db.dailyAgentBudget.findFirstOrThrow({ where: { ownerId: id } });
  async function start(f: Awaited<ReturnType<typeof fixture>>, factory?: AgentFactory, events?: AppEvent[], content = 'Research my holdings and news') {
    return startChatRun({ ownerId: f.id, chat: f.chat, conversationId: f.conversation.id, body: { content }, tools: f.tools,
      coordinator: new LocalRunCoordinator(), agentFactory: factory ?? (tools => new MockPortfolioAgentService(tools)),
      replayCursor: async () => null, events: events ? async e => { events.push(e); } : null });
  }
  it('concurrent conversations cannot exceed a daily reservation; denied runs leave no user message', async () => {
    const f = await fixture();
    const conversations = await Promise.all(Array.from({ length: 12 }, () => f.chat.create({})));
    const results = await Promise.allSettled(conversations.map(c => f.chat.startRun(c.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content: 'Question', budget: { reserveUsd: '0.2', dailyUsd: '0.6' } })));
    const accepted = results.filter(r => r.status === 'fulfilled');
    expect(accepted).toHaveLength(3);
    expect(results.filter(r => r.status === 'rejected').every(r => r.status === 'rejected' && r.reason.status === 429)).toBe(true);
    expect((await ledger(f.id)).reservedUsd.toFixed(6)).toBe('0.600000');
    expect(await db.chatMessage.count({ where: { conversation: { ownerId: f.id } } })).toBe(3);
    await Promise.all(accepted.map(r => r.status === 'fulfilled' ? f.chat.finishRun(r.value.run.id, terminal()) : null));
    expect((await ledger(f.id)).reservedUsd.toFixed(6)).toBe('0.000000');
    expect((await ledger(f.id)).chargedUsd.toFixed(6)).toBe('0.150000');
  });
  it('completion reconciles once; foreign finish and same-conversation collisions cannot alter the ledger', async () => {
    const f = await fixture(), foreign = await fixture();
    const row = await f.chat.startRun(f.conversation.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content: 'q' });
    await expect(foreign.chat.finishRun(row.run.id, terminal())).rejects.toMatchObject({ status: 404 });
    await expect(f.chat.startRun(f.conversation.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content: 'q2' })).rejects.toMatchObject({ status: 409 });
    expect((await ledger(f.id)).reservedUsd.toFixed(6)).toBe('0.200000');
    const fence = await leaseTestRun(db, row.run.id);
    const workerChat = chatService(db, await (await import('@portfolio-pilot/db')).ownerForAgentRun(db, fence), fence);
    const finishes = await Promise.all([workerChat.finishRun(row.run.id, terminal()), workerChat.finishRun(row.run.id, terminal())]);
    expect(finishes.filter(Boolean)).toHaveLength(1);
    expect((await ledger(f.id)).chargedUsd.toFixed(6)).toBe('0.050000');
  });
  it('crash reconciliation keeps the full reservation and emits a terminal event', async () => {
    const f = await fixture(), events: AppEvent[] = [];
    const row = await f.chat.startRun(f.conversation.id, { runId: randomUUID(), assistantMessageId: randomUUID(), content: 'q' });
    await db.agentRun.update({ where: { id: row.run.id }, data: { status: 'running', executionStartedAt: new Date(0), leaseUntil: new Date(0) } });
    await reconcileStaleRuns({ ownerId: f.id, chat: f.chat, coordinator: new LocalRunCoordinator(), events: async e => { events.push(e); } });
    expect((await ledger(f.id)).reservedUsd.toFixed(6)).toBe('0.000000');
    expect((await ledger(f.id)).chargedUsd.toFixed(6)).toBe('0.200000');
    expect((await f.chat.getRun(row.run.id)).usage?.accounting).toBe('conservative');
    expect(events.at(-1)?.type).toBe('agent.run.completed');
  });
  it('an uncooperative stream reaches a durable timeout, without hanging events', async () => {
    vi.stubEnv('AGENT_WALL_CLOCK_MS', '100');
    const f = await fixture(), events: AppEvent[] = [];
    const row = await start(f, fakeAgent(async () => new Promise(() => {})), events);
    await row.done;
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ status: 'failed', failureCode: 'timeout', usage: { accounting: 'conservative' } });
    expect((await f.chat.messages(f.conversation.id, {})).messages.at(-1)?.content).toContain('time limit');
    expect(events.at(-1)?.type).toBe('agent.run.completed');
  });
  it.each([['AGENT_MAX_PROMPT_BYTES', '256', 'prompt_limit'], ['AGENT_MAX_TOOL_RESULT_BYTES', '256', 'tool_result_limit'], ['AGENT_MAX_TURNS', '1', 'error_max_turns']])('ends %s limits predictably', async (key, value, code) => {
    vi.stubEnv(key, value);
    const f = await fixture(), events: AppEvent[] = [];
    const row = await start(f, undefined, events, key === 'AGENT_MAX_PROMPT_BYTES' ? 'Question '.repeat(100) : undefined); await row.done;
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ status: 'failed', failureCode: code });
    expect(events.at(-1)?.type).toBe('agent.run.completed');
    expect((await ledger(f.id)).reservedUsd.toFixed(6)).toBe('0.000000');
  });
  it('counts callback and returned usage once, records the actual runtime model, and charges cost overruns', async () => {
    const f = await fixture();
    const row = await start(f, fakeAgent(async input => {
      const report = usage(0.25); input.onModel?.('runtime-reported-model'); input.onUsage?.(report); input.onUsage?.(report);
      return { mode: 'claude', text: 'answer', sessionId: null, usage: report };
    })); await row.done;
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ failureCode: 'error_max_budget_usd', actualModel: 'runtime-reported-model', usage: { resultCount: 1, aggregateTokens: 999, estimatedCostUsd: '0.250000', accounting: 'sdk_estimate' } });
    expect((await ledger(f.id)).chargedUsd.toFixed(6)).toBe('0.250000');
  });
  it('retries share cost and turn limits, rather than granting a fresh budget', async () => {
    const f = await fixture(); const caps: number[] = [];
    const row = await startChatRun({ ownerId: f.id, chat: f.chat, conversationId: f.conversation.id, body: { content: 'Analyze news', kind: 'news_analysis' }, tools: f.tools, coordinator: new LocalRunCoordinator(), events: null, replayCursor: async () => null,
      agentFactory: fakeAgent(async input => { caps.push(input.limits!.costUsd); const report = usage(0.06); input.onUsage?.(report); return { mode: 'claude', text: '', sessionId: null, structuredOutput: {}, usage: report }; }) });
    await row.done;
    expect(caps).toEqual([0.1, 0.04]);
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ failureCode: 'error_max_budget_usd', usage: { estimatedCostUsd: '0.120000', resultCount: 2 } });
  });
  it('does not spend another attempt when the first attempt has no reliable telemetry', async () => {
    const f = await fixture(); const stream = vi.fn(async () => ({ mode: 'claude' as const, text: '', sessionId: null, structuredOutput: {} }));
    const row = await startChatRun({ ownerId: f.id, chat: f.chat, conversationId: f.conversation.id, body: { content: 'Analyze news', kind: 'news_analysis' }, tools: f.tools,
      coordinator: new LocalRunCoordinator(), events: null, replayCursor: async () => null, agentFactory: fakeAgent(stream) });
    await row.done;
    expect(stream).toHaveBeenCalledOnce();
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ failureCode: 'usage_uncertain', usage: { accounting: 'conservative' } });
    expect((await ledger(f.id)).chargedUsd.toFixed(6)).toBe('0.200000');
  });
  it('explicit cancellation ends a stalled stream and retains uncertain usage', async () => {
    const f = await fixture(), coordinator = new LocalRunCoordinator(), events: AppEvent[] = [];
    let entered!: () => void; const streaming = new Promise<void>(resolve => { entered = resolve; });
    const row = await startChatRun({ ownerId: f.id, chat: f.chat, conversationId: f.conversation.id, body: { content: 'Question' }, tools: f.tools,
      coordinator, events: async e => { events.push(e); }, replayCursor: async () => null, agentFactory: fakeAgent(async () => { entered(); return new Promise(() => {}); }) });
    await streaming; // Cancellation after query invocation has uncertain usage; earlier cancellation is zero-cost.
    await cancelChatRun({ ownerId: f.id, chat: f.chat, runId: row.run.id, coordinator, events: null }); await row.done;
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ status: 'cancelled' });
    expect((await ledger(f.id)).chargedUsd.toFixed(6)).toBe('0.200000'); expect(events.at(-1)?.type).toBe('agent.run.completed');
  });
  it('fails instead of answering with a silently truncated all-portfolio scope', async () => {
    const f = await fixture();
    await db.portfolio.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ ownerId: f.id, name: `Extra portfolio ${i}` })) });
    const row = await start(f, undefined, undefined, 'What do I own?'); await row.done;
    expect(await f.chat.getRun(row.run.id)).toMatchObject({ status: 'failed', failureCode: 'scope_limit' });
    expect((await f.chat.messages(f.conversation.id, {})).messages.at(-1)?.content).toContain('full portfolio scope');
  });
  it('explicit context reset preserves saved sources, current request, scope and historical freshness labels', async () => {
    vi.stubEnv('AGENT_CONTEXT_RESET_TURNS', '1');
    const f = await fixture();
    await f.chat.append(f.conversation.id, { role: 'assistant', content: 'Old analysis', status: 'completed', mode: 'claude', instructionVersion: PORTFOLIO_INSTRUCTION_VERSION,
      sources: [{ articleId: 'old-article', title: 'Old report', url: 'https://example.invalid/old', publishedAt: '2026-01-01T00:00:00.000Z', isSynthetic: true }] });
    await db.conversationSession.create({ data: { conversationId: f.conversation.id, sdkSessionId: randomUUID(), agentMode: 'claude', hostKey: 'fixture', modelKey: 'fixture', instructionVersion: PORTFOLIO_INSTRUCTION_VERSION } });
    let prompt: any;
    const row = await start(f, fakeAgent(async input => { prompt = JSON.parse(input.prompt); expect(input.resumeSessionId).toBeNull(); return { mode: 'claude', text: 'Fresh answer', sessionId: null, usage: usage(0.01) }; }));
    await row.done;
    expect(prompt).toMatchObject({ portfolioId: null, scope: { activePortfolios: true }, request: 'Research my holdings and news', continuity: 'reseeded', seed: { citedSources: [{ articleId: 'old-article', url: 'https://example.invalid/old', publishedAt: '2026-01-01T00:00:00.000Z' }] } });
    expect(prompt.seed.note).toContain('Historical analysis only, not fresh market data');
    expect((await f.chat.messages(f.conversation.id, {})).messages.at(-1)?.continuity).toMatchObject({ disposition: 'reseeded', reason: 'context_limit' });
  });
});
