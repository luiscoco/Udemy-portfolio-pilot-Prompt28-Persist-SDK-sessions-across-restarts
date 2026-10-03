import type { AgentRunEvent } from '@portfolio-pilot/agent';
import type { AgentAppEvent, AppEvent, ChatMessage } from '@portfolio-pilot/contracts';
import { buildEvent, uuidV5, type NewAppEvent } from '@portfolio-pilot/db';

/** Where run events go: the owner's Redis stream in the API, an array in tests, nothing without Redis. */
export type RunEventTarget = (event: AppEvent) => Promise<unknown>;
/**
 * Text deltas are coalesced so one answer adds tens of stream entries, not hundreds: the owner
 * stream is trimmed near 1,000 entries (ADR 0007) and other tabs replay from it.
 */
export const RUN_EVENT_LIMITS = { flushMs: 150, flushChars: 1024, deltaChars: 8192 } as const;

type Payload<T extends AgentAppEvent['type']> = Omit<Extract<AgentAppEvent, { type: T }>['payload'], 'conversationId' | 'messageId' | 'sequence'>;

/**
 * Turns adapter events into ordered, typed application events for ONE assistant message.
 * - `sequence` is assigned at publication time and is contiguous from 0 for the message.
 * - IDs are UUIDv5(run, sequence): a republished event keeps its identity, so consumers dedupe.
 * - Publication is strictly sequential; a failed publish leaves a sequence gap that clients detect
 *   and repair from the authoritative block/message, never by guessing text.
 */
export class RunEventPublisher {
  private sequence = 0;
  private visibleBytes = 0;
  private buffer: { blockId: string; offset: number; text: string } | null = null;
  private readonly offsets = new Map<string, number>();
  private readonly completed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  failures = 0;

  constructor(private readonly target: RunEventTarget | null, private readonly ids: { ownerId: string; runId: string; conversationId: string; messageId: string },
    private readonly limits: { flushMs: number; flushChars: number; deltaChars: number } = RUN_EVENT_LIMITS) {}

  get published() { return this.sequence; }
  /** For a finisher that cannot know the worker's last sequence: jump ahead, leaving a detectable gap. */
  skipTo(sequence: number) { this.sequence = Math.max(this.sequence, sequence); }
  started(userMessageId: string) { this.enqueue('agent.run.started', { userMessageId }); }

  agent(event: AgentRunEvent) {
    this.visibleBytes += Buffer.byteLength(JSON.stringify(event));
    if (this.visibleBytes > 262144 || this.sequence >= 512) { this.failures++; return; }
    switch (event.type) {
      case 'text.delta': {
        if (this.completed.has(event.blockId)) return;
        if (this.buffer && this.buffer.blockId !== event.blockId) this.flushText();
        if (!this.buffer) {
          this.buffer = { blockId: event.blockId, offset: this.offsets.get(event.blockId) ?? 0, text: '' };
          this.timer = setTimeout(() => this.flushText(), this.limits.flushMs);
        }
        this.buffer.text += event.text;
        this.offsets.set(event.blockId, (this.offsets.get(event.blockId) ?? 0) + event.text.length);
        if (this.buffer.text.length >= this.limits.flushChars) this.flushText();
        return;
      }
      case 'block.completed':
        // The authoritative text replaces the draft, so unsent draft text for this block is dropped.
        if (this.buffer?.blockId === event.blockId) this.dropBuffer(); else this.flushText();
        if (this.completed.has(event.blockId)) return;
        this.completed.add(event.blockId);
        this.enqueue('agent.block.completed', { blockId: event.blockId, text: event.text });
        return;
      case 'tool.status':
        this.flushText();
        this.enqueue('agent.tool.status', { toolCallId: event.toolCallId, tool: event.tool, status: event.status });
        return;
    }
  }

  /** The persisted message is authoritative for the whole answer; pending draft text is dropped. */
  finished(message: ChatMessage, status: 'completed' | 'failed' | 'cancelled') {
    this.dropBuffer();
    this.enqueue('agent.message.completed', { message });
    this.enqueue('agent.run.completed', { status });
  }
  /** Another finisher already announced the outcome: stop without publishing more. */
  abandon() { this.dropBuffer(); }
  async drain() { this.flushText(); await this.chain; }

  private dropBuffer() { clearTimeout(this.timer); this.buffer = null; }
  private flushText() {
    clearTimeout(this.timer);
    const buffer = this.buffer;
    this.buffer = null;
    if (!buffer?.text) return;
    for (let at = 0; at < buffer.text.length; at += this.limits.deltaChars) {
      this.enqueue('agent.text.delta', { blockId: buffer.blockId, offset: buffer.offset + at, text: buffer.text.slice(at, at + this.limits.deltaChars) });
    }
  }
  private enqueue<T extends AgentAppEvent['type']>(type: T, payload: Payload<T>) {
    if (this.sequence >= 512) { this.failures++; return; }
    const { ownerId, runId, conversationId, messageId } = this.ids;
    const sequence = this.sequence++;
    let event: AppEvent;
    try {
      event = buildEvent({ id: uuidV5(`agent-run:${runId}:${sequence}`), type, audience: { kind: 'user', userId: ownerId }, entityType: 'agent_run',
        entityId: runId, portfolioId: null, payload: { conversationId, messageId, sequence, ...payload } } as unknown as NewAppEvent);
    } catch { this.failures++; return; }
    const target = this.target;
    if (!target) return;
    this.chain = this.chain.then(() => target(event)).then(() => {}, () => { this.failures++; });
  }
}
