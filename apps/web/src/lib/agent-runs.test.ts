import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@portfolio-pilot/contracts';
import { AgentRunStore, applyAgentEvent, type AgentBrowserEvent, type RunsState } from './agent-runs';
import { invalidateEvent, StreamManager } from './stream-manager';

let n = 0;
const common = { schemaVersion: 1 as const, occurredAt: '2026-10-02T10:00:00.000Z', runId: 'run', conversationId: 'conv', messageId: 'msg' };
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const message: ChatMessage = { id: 'msg', conversationId: 'conv', role: 'assistant', content: 'Your largest holding is ACME.', status: 'completed', mode: 'mock', instructionVersion: 'portfolio-research-v1', sources: [], createdAt: '2026-10-02T10:00:01.000Z', kind: 'answer', analysis: null, continuity: { disposition: 'new', reason: null } };
/** A recorded application-event stream for one run (as delivered over SSE). */
const recorded: AgentBrowserEvent[] = [
  { ...common, id: id(), type: 'agent.run.started', sequence: 0, userMessageId: 'user' },
  { ...common, id: id(), type: 'agent.tool.status', sequence: 1, toolCallId: 'msg.t0', tool: 'listHoldings', status: 'started' },
  { ...common, id: id(), type: 'agent.tool.status', sequence: 2, toolCallId: 'msg.t0', tool: 'listHoldings', status: 'succeeded' },
  { ...common, id: id(), type: 'agent.text.delta', sequence: 3, blockId: 'msg.b0', offset: 0, text: 'Your largest ' },
  { ...common, id: id(), type: 'agent.text.delta', sequence: 4, blockId: 'msg.b0', offset: 13, text: 'holding is ACME.' },
  { ...common, id: id(), type: 'agent.block.completed', sequence: 5, blockId: 'msg.b0', text: 'Your largest holding is ACME.' },
  { ...common, id: id(), type: 'agent.message.completed', sequence: 6, message },
  { ...common, id: id(), type: 'agent.run.completed', sequence: 7, status: 'completed' }
];
const reduce = (events: AgentBrowserEvent[], state: RunsState = {}) => events.reduce(applyAgentEvent, state);
const draft = (state: RunsState) => state.run!.blocks.map(b => b.text).join('\n\n');

describe('agent run reconciliation in the browser', () => {
  it('builds the draft from deltas and replaces it with the authoritative block and message exactly once', () => {
    const partial = reduce(recorded.slice(0, 5));
    expect(draft(partial)).toBe('Your largest holding is ACME.');
    expect(partial.run!.blocks[0]).toMatchObject({ complete: false, broken: false });
    const done = reduce(recorded);
    expect(draft(done)).toBe('Your largest holding is ACME.');
    expect(done.run).toMatchObject({ status: 'completed', final: message, gap: false, nextSequence: 8 });
    expect(done.run!.tools).toEqual([{ toolCallId: 'msg.t0', tool: 'listHoldings', status: 'succeeded' }]);
  });
  it('ignores duplicate delivery of every event, in any repetition', () => {
    const once = reduce(recorded);
    const twice = reduce(recorded.flatMap(e => [e, e]));
    const replayed = reduce(recorded, reduce(recorded));
    for (const state of [twice, replayed]) expect(state).toEqual(once);
    expect(applyAgentEvent(once, recorded[4]!)).toBe(once); // unchanged object: nothing re-rendered
  });
  it('never appends text twice: overlapping redelivery with new sequence is ignored, a gap marks the draft broken', () => {
    const overlap = reduce([...recorded.slice(0, 5), { ...recorded[4]!, id: id(), sequence: 5 }]);
    expect(draft(overlap)).toBe('Your largest holding is ACME.');
    const gapped = reduce([recorded[0]!, recorded[3]!, { ...common, id: id(), type: 'agent.text.delta', sequence: 9, blockId: 'msg.b0', offset: 40, text: 'tail' }]);
    expect(gapped.run).toMatchObject({ gap: true });
    expect(gapped.run!.blocks[0]).toMatchObject({ broken: true, text: 'Your largest ' });
    // The authoritative completion repairs the broken draft.
    const repaired = reduce([{ ...common, id: id(), type: 'agent.block.completed', sequence: 10, blockId: 'msg.b0', text: 'Your largest holding is ACME.' }], gapped);
    expect(repaired.run!.blocks[0]).toEqual({ blockId: 'msg.b0', text: 'Your largest holding is ACME.', complete: true, broken: false });
  });
  it('joins a run mid-stream after reload (first event is not sequence 0) without inventing text', () => {
    const state = reduce(recorded.slice(4));
    expect(state.run!.gap).toBe(true);
    expect(state.run!.final).toEqual(message);
    expect(draft(state)).toBe('Your largest holding is ACME.');
  });
  it('records tool-only steps and failures in order, and cancellation with its persisted message', () => {
    const cancelled = { ...message, status: 'cancelled' as const, content: 'You cancelled this answer before it finished. No trades or changes were made.', mode: null };
    const state = reduce([recorded[0]!, recorded[1]!,
      { ...common, id: id(), type: 'agent.tool.status', sequence: 2, toolCallId: 'msg.t0', tool: 'listHoldings', status: 'failed' },
      { ...common, id: id(), type: 'agent.tool.status', sequence: 3, toolCallId: 'msg.t0', tool: 'listHoldings', status: 'running' },
      { ...common, id: id(), type: 'agent.message.completed', sequence: 4, message: cancelled },
      { ...common, id: id(), type: 'agent.run.completed', sequence: 5, status: 'cancelled' }]);
    expect(state.run!.tools).toEqual([{ toolCallId: 'msg.t0', tool: 'listHoldings', status: 'failed' }]);
    expect(state.run).toMatchObject({ status: 'cancelled', final: cancelled, blocks: [] });
  });
  it('rejects events whose message identity does not match the run', () => {
    const state = reduce(recorded.slice(0, 2));
    expect(applyAgentEvent(state, { ...recorded[3]!, messageId: 'other', sequence: 2 })).toBe(state);
  });
  it('store notifies only on change and stays bounded', () => {
    const store = new AgentRunStore(); const listener = vi.fn();
    store.subscribe(listener);
    for (const e of recorded) store.apply(e);
    store.apply(recorded[2]!);
    expect(listener).toHaveBeenCalledTimes(recorded.length);
    for (let i = 0; i < 60; i++) store.apply({ ...recorded[0]!, runId: `r${i}` });
    expect(Object.keys(store.getSnapshot())).toHaveLength(50);
  });
});

describe('stream manager integration', () => {
  it('refreshes persisted chat reads on durable outcomes only', async () => {
    const cache = new QueryClient();
    for (const key of [['chat-messages', 'conv'], ['chat-run', 'conv'], ['chat-messages', 'other']]) cache.setQueryData(key, {});
    invalidateEvent(cache, recorded[3]!);
    invalidateEvent(cache, recorded[6]!); invalidateEvent(cache, recorded[7]!);
    await vi.waitFor(() => expect(cache.getQueryState(['chat-run', 'conv'])?.isInvalidated).toBe(true));
    expect(cache.getQueryState(['chat-messages', 'conv'])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(['chat-messages', 'other'])?.isInvalidated).toBe(false);
  });
  it('replays from the pre-run cursor only when its own cursor may postdate the run', () => {
    const sources: string[] = [];
    vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('EventSource', class { onopen = null; onerror = null; constructor(url: string) { sources.push(url); } addEventListener() {} close() {} });
    try {
      const manager = new StreamManager('alice', new QueryClient());
      const internal = manager as unknown as { running: boolean; cursor: string | null; recovering: boolean; replayFloor: string | null };
      internal.running = true; internal.cursor = 'connection-cursor';
      manager.ensureReplay(manager.recoveries, 'pre-run');
      expect(sources).toEqual([]); // its cursor predates the POST: nothing to do
      manager.ensureReplay(manager.recoveries - 1, 'pre-run');
      expect(sources).toEqual(['/api/events?cursor=pre-run']); // a recovery happened meanwhile
      internal.recovering = true;
      manager.ensureReplay(manager.recoveries, 'later');
      expect(internal.replayFloor).toBe('later'); // deferred to the snapshot being loaded
    } finally { vi.unstubAllGlobals(); }
  });
});

it('repairs a gapped draft from durable chunks without duplicating later SSE or the final message', () => {
 const store = new AgentRunStore();
 for (const event of recorded.filter(e => e.sequence !== 3)) store.apply(event);
 expect(store.getSnapshot().run!.gap).toBe(true);
 store.recover('run', recorded);
 expect(store.getSnapshot().run).toMatchObject({ gap: false, final: message, nextSequence: 8 });
 for (const event of recorded) store.apply(event);
 expect(store.getSnapshot().run!.final).toEqual(message);
 expect(draft(store.getSnapshot())).toBe('Your largest holding is ACME.');
});
