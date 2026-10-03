import type { AgentToolName, BrowserEvent, ChatMessage } from '@portfolio-pilot/contracts';

export type AgentBrowserEvent = Extract<BrowserEvent, { runId: string }>;
export const isAgentEvent = (event: BrowserEvent): event is AgentBrowserEvent => 'runId' in event;

export type DraftBlock = { blockId: string; text: string; complete: boolean; /** Some of its draft text was missed. */ broken: boolean };
export type ToolProgress = { toolCallId: string; tool: AgentToolName; status: 'started' | 'running' | 'succeeded' | 'failed' };
export type RunView = {
  runId: string; conversationId: string; messageId: string;
  /** Next expected per-message sequence; anything lower is a duplicate. */
  nextSequence: number;
  /** At least one event was missed (reconnect, reset, failed publication). */
  gap: boolean;
  blocks: DraftBlock[]; tools: ToolProgress[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** The persisted, authoritative assistant message; replaces the draft exactly once. */
  final: ChatMessage | null;
};
export type RunsState = Readonly<Record<string, RunView>>;
const TOOL_RANK = { started: 0, running: 1, succeeded: 2, failed: 2 } as const;

/**
 * Pure reconciliation of one agent event. Rules:
 * - per-message `sequence` below the expected one is a duplicate and changes nothing;
 * - a sequence above it is a gap: open drafts are marked broken (never shown as if complete);
 * - a delta applies only at its exact `offset`, so redelivered or overlapping text is never appended twice;
 * - `block.completed` and `message.completed` REPLACE drafts with authoritative text, once.
 */
export function applyAgentEvent(state: RunsState, event: AgentBrowserEvent): RunsState {
  const current: RunView = state[event.runId] ?? { runId: event.runId, conversationId: event.conversationId, messageId: event.messageId, nextSequence: 0, gap: false, blocks: [], tools: [], status: 'running', final: null };
  if (event.messageId !== current.messageId || event.conversationId !== current.conversationId) return state;
  if (event.sequence < current.nextSequence) return state;
  const gap = event.sequence > current.nextSequence;
  const run: RunView = { ...current, nextSequence: event.sequence + 1, gap: current.gap || gap,
    blocks: gap ? current.blocks.map(b => b.complete ? b : { ...b, broken: true }) : current.blocks };
  switch (event.type) {
    case 'agent.text.delta': {
      const block = run.blocks.find(b => b.blockId === event.blockId) ?? { blockId: event.blockId, text: '', complete: false, broken: false };
      let next = block;
      if (block.complete) break;
      if (event.offset === block.text.length) next = { ...block, text: block.text + event.text };
      else if (event.offset + event.text.length > block.text.length) next = { ...block, broken: true };
      run.blocks = upsert(run.blocks, next, b => b.blockId);
      break;
    }
    case 'agent.block.completed':
      run.blocks = upsert(run.blocks, { blockId: event.blockId, text: event.text, complete: true, broken: false }, b => b.blockId);
      break;
    case 'agent.tool.status': {
      const tool = run.tools.find(t => t.toolCallId === event.toolCallId);
      if (!tool || TOOL_RANK[event.status] > TOOL_RANK[tool.status]) run.tools = upsert(run.tools, { toolCallId: event.toolCallId, tool: event.tool, status: event.status }, t => t.toolCallId);
      break;
    }
    case 'agent.message.completed': run.final = event.message; break;
    case 'agent.run.completed': run.status = event.status; break;
    case 'agent.run.started': break;
  }
  return { ...state, [event.runId]: run };
}
function upsert<T>(items: T[], item: T, key: (value: T) => string): T[] {
  const index = items.findIndex(existing => key(existing) === key(item));
  return index < 0 ? [...items, item] : items.map((existing, i) => i === index ? item : existing);
}

/** Per authenticated scope; bounded so a long session cannot grow without limit. */
export class AgentRunStore {
  private state: RunsState = {};
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  apply(event: AgentBrowserEvent) {
    const next = applyAgentEvent(this.state, event);
    if (next === this.state) return;
    const ids = Object.keys(next);
    this.state = ids.length > 50 ? Object.fromEntries(ids.slice(-50).map(id => [id, next[id]!])) : next;
    this.listeners.forEach(listener => listener());
  }
  recover(runId: string, events: AgentBrowserEvent[]) {
    if (!events.length) return;
    let recovered: RunsState = {};
    for (const event of events) recovered = applyAgentEvent(recovered, event);
    const current = this.state[runId], next = recovered[runId];
    if (!next || (current && current.nextSequence > next.nextSequence && !current.gap)) return;
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    const merged = { ...this.state, [runId]: next }, ids = Object.keys(merged);
    this.state = ids.length > 50 ? Object.fromEntries(ids.slice(-50).map(id => [id, merged[id]!])) : merged;
    this.listeners.forEach(listener => listener());
  }
  clear() { this.state = {}; this.listeners.forEach(listener => listener()); }
}
