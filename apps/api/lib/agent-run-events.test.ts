import { describe, expect, it, vi } from 'vitest';
import { appEventSchema, chatMessageSchema, type AppEvent } from '@portfolio-pilot/contracts';
import { RunEventPublisher } from '../../worker/src/agent-run-events';
import { publicEvent } from './browser-event';

const ids = { ownerId: 'demo-alice', runId: 'run-1', conversationId: 'conv-1', messageId: 'msg-1' };
const message = chatMessageSchema.parse({ id: 'msg-1', conversationId: 'conv-1', role: 'assistant', content: 'Hello world', status: 'completed', mode: 'mock', instructionVersion: 'portfolio-research-v1', sources: [], createdAt: '2026-10-02T10:00:00.000Z' });
function publisher(limits = { flushMs: 50, flushChars: 10, deltaChars: 8 }) {
  const published: AppEvent[] = [];
  return { published, events: new RunEventPublisher(async e => { published.push(appEventSchema.parse(e)); }, ids, limits) };
}
describe('ordered run event publication', () => {
  it('coalesces deltas with offsets, drops draft text superseded by completion and numbers events contiguously', async () => {
    const { published, events } = publisher({ flushMs: 50, flushChars: 10, deltaChars: 64 });
    events.started('user-1');
    for (const text of ['Hel', 'lo ', 'wor']) events.agent({ type: 'text.delta', blockId: 'b0', text });
    events.agent({ type: 'tool.status', toolCallId: 't0', tool: 'listHoldings', status: 'started' });
    events.agent({ type: 'text.delta', blockId: 'b0', text: 'ld' });
    events.agent({ type: 'block.completed', blockId: 'b0', text: 'Hello world' });
    events.agent({ type: 'block.completed', blockId: 'b0', text: 'Hello world' });
    events.agent({ type: 'text.delta', blockId: 'b0', text: 'late' });
    events.finished(message, 'completed');
    await events.drain();
    expect(published.map(e => e.type)).toEqual(['agent.run.started', 'agent.text.delta', 'agent.tool.status', 'agent.block.completed', 'agent.message.completed', 'agent.run.completed']);
    expect(published.map(e => (e as Extract<AppEvent, { entityType: 'agent_run' }>).payload.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(published[1]!.payload).toMatchObject({ blockId: 'b0', offset: 0, text: 'Hello wor' });
    for (const event of published) expect(publicEvent(event)).not.toBeNull();
  });
  it('splits large deltas, keeps offsets exact, and flushes on a timer', async () => {
    vi.useFakeTimers();
    try {
      const { published, events } = publisher({ flushMs: 50, flushChars: 100, deltaChars: 8 });
      events.agent({ type: 'text.delta', blockId: 'b0', text: 'abcdefghij' });
      await vi.advanceTimersByTimeAsync(60);
      events.agent({ type: 'text.delta', blockId: 'b0', text: 'KL' });
      await events.drain();
      expect(published.map(e => e.type === 'agent.text.delta' && [e.payload.offset, e.payload.text])).toEqual([[0, 'abcdefgh'], [8, 'ij'], [10, 'KL']]);
    } finally { vi.useRealTimers(); }
  });
  it('derives stable IDs from (run, sequence) and records failed publications as gaps, not reorders', async () => {
    const first = publisher(), second = publisher();
    for (const p of [first, second]) { p.events.started('u'); p.events.finished(message, 'completed'); await p.events.drain(); }
    expect(first.published.map(e => e.id)).toEqual(second.published.map(e => e.id));
    let calls = 0; const delivered: number[] = [];
    const flaky = new RunEventPublisher(async e => { if (calls++ === 1) throw new Error('redis down'); delivered.push((e as Extract<AppEvent, { entityType: 'agent_run' }>).payload.sequence); }, ids);
    flaky.started('u'); flaky.agent({ type: 'tool.status', toolCallId: 't', tool: 'other', status: 'started' }); flaky.finished(message, 'failed');
    await flaky.drain();
    expect(delivered).toEqual([0, 2, 3]); expect(flaky.failures).toBe(1);
  });
});

it('bounds the worker publication queue when a runtime emits excessive progress', async () => {
 const published: AppEvent[] = [];
 const events = new RunEventPublisher(async event => { published.push(event); }, ids);
 for (let n=0;n<2000;n++) events.agent({ type: 'tool.status', toolCallId: 'tool-' + n, tool: 'other', status: 'running' });
 await events.drain();
 expect(published.length).toBeLessThanOrEqual(512);
 expect(events.failures).toBeGreaterThan(0);
});
