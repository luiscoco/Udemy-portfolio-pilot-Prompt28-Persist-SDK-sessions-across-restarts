import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AGENT_TEXT_LIMIT, type AgentToolName } from '@portfolio-pilot/contracts';
import { AgentRunFailure, AnswerTooLongError } from './errors.js';
import { PORTFOLIO_TOOL_SERVER_NAME } from './tools/portfolio-tools.js';
import { PORTFOLIO_TOOL_NAMES } from './tools/schemas.js';

/**
 * Application-level run events produced by every agent adapter (live SDK and mock). They carry
 * application block/tool IDs, never SDK message UUIDs, tool arguments, tool results or thinking.
 */
export type AgentRunEvent =
  | { type: 'text.delta'; blockId: string; text: string }
  | { type: 'block.completed'; blockId: string; text: string }
  | { type: 'tool.status'; toolCallId: string; tool: AgentToolName; status: 'started' | 'running' | 'succeeded' | 'failed' };
export type AgentEventSink = (event: AgentRunEvent) => void;
export interface AgentRunResult {
  reportedModel?: string | null;
  usage?: import('./delegation.js').ResearchUsage;
  mode: 'mock' | 'claude';
  /** Visible answer text; empty for structured runs, whose text the server renders after validation. */
  text: string;
  /** SDK session that now holds this turn (null if the adapter never learned it). */
  sessionId: string | null;
  /** Raw `structured_output` for structured runs. UNTRUSTED until validated server-side. */
  structuredOutput?: unknown;
}
export interface AgentStreamInput {
  limits?: { promptBytes: number; toolResultBytes: number; turns: number; costUsd: number };
  onUsage?: (usage: import('./delegation.js').ResearchUsage) => void;
  onModel?: (model: string) => void;
  /** Trusted server correlation, never taken from prompt/tool arguments. */
  audit?: import('./policy-hooks.js').AuditIdentity;
  prompt: string;
  /** Application assistant message ID; block and tool-call IDs derive from it. */
  messageId: string;
  signal?: AbortSignal;
  onEvent: AgentEventSink;
  /** Resume this SDK session (documented `resume` option). Absent or null starts a new session. */
  resumeSessionId?: string | null;
  /** Request documented structured output (`outputFormat: json_schema`) with this draft-07 schema. */
  outputSchema?: Record<string, unknown>;
}
/** Where an adapter's sessions live. Session state is local: a binding is usable only on the same host key. */
export interface AgentSessionLocator {
  /** Identifies the session storage this process can read (host + workspace, or the mock process). */
  readonly hostKey: string;
  /** Model configuration; a session started under another model is not resumed. */
  readonly modelKey: string;
  /** True only if the session's transcript can be loaded here right now. */
  isAvailable(sessionId: string): Promise<boolean>;
}
/** Adapters that report progress as application events and return the authoritative answer. */
export interface StreamingAgentService {
  checkpoint?(sessionId: string): Promise<import('./session-artifacts.js').SessionArtifactRef>;
  cleanup?(): Promise<void>;
  stream(input: AgentStreamInput): Promise<AgentRunResult>;
  sessions(): Promise<AgentSessionLocator>;
}

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type AssistantMessage = Extract<SDKMessage, { type: 'assistant' }>;
type Block = { blockId: string; draft: string; final: string | null };
type ToolStatus = Extract<AgentRunEvent, { type: 'tool.status' }>['status'];
const TOOL_STATUS_RANK: Record<ToolStatus, number> = { started: 0, running: 1, succeeded: 2, failed: 2 };

/** Maps an SDK tool name to the public allowlist; anything else is reported only as "other". */
export function publicToolName(sdkName: string): AgentToolName {
  if (sdkName === 'Agent' || sdkName === 'Task') return 'delegation';
  if (sdkName === 'mcp__portfolio__researchExternal') return 'researchExternal';
  const prefix = `mcp__${PORTFOLIO_TOOL_SERVER_NAME}__`;
  const bare = sdkName.startsWith(prefix) ? sdkName.slice(prefix.length) : '';
  return (PORTFOLIO_TOOL_NAMES as readonly string[]).includes(bare) ? bare as AgentToolName : 'other';
}

/**
 * Converts the installed SDK's discriminated messages (with `includePartialMessages: true`) into
 * application events. Reconciliation rule: `stream_event` text deltas build a DRAFT for a block;
 * the completed `assistant` message that later delivers that block is AUTHORITATIVE and is emitted
 * once as `block.completed` (replacing, never appending to, the draft). The final `result.result`
 * repeats text already delivered, so it is used only when no text block was observed at all.
 * Subagent frames (`parent_tool_use_id`), thinking and tool-input deltas are never surfaced.
 */
export class SdkStreamMapper {
  private readonly blocks: Block[] = [];
  /** Open stream blocks keyed by `${apiMessageId}:${index}`. */
  private readonly open = new Map<string, Block>();
  /** Per API message, drafts not yet matched to an authoritative block, in stream order. */
  private readonly pending = new Map<string, Block[]>();
  private readonly tools = new Map<string, { toolCallId: string; tool: AgentToolName; status: ToolStatus }>();
  private readonly seen = new Set<string>();
  private apiMessageId: string | null = null;
  private blockCount = 0;
  private toolCount = 0;
  private length = 0;
  private result: Extract<SDKMessage, { type: 'result' }> | null = null;
  private assistantError: string | null = null;
  /** SDK session ID from the `system/init` message or the `result` (documented capture points). */
  sessionId: string | null = null;
  /** Whether the model produced any visible text or tool call; a resume that fails before this is safe to replace. */
  observedOutput = false;

  /** `suppressText`: structured runs announce nothing textual until the server validated the output. */
  constructor(private readonly messageId: string, private readonly emit: AgentEventSink, private readonly options: { suppressText?: boolean } = {}) {}

  accept(message: SDKMessage): void {
    // Duplicate SDK frames (same uuid) are ignored so a repeated completed block cannot apply twice.
    if ('uuid' in message && typeof message.uuid === 'string') {
      if (this.seen.has(message.uuid)) return;
      this.seen.add(message.uuid);
    }
    if ('parent_tool_use_id' in message && message.parent_tool_use_id !== null) return;
    if (message.type === 'system' && message.subtype === 'init') this.sessionId = message.session_id;
    if (message.type === 'result') this.sessionId = message.session_id;
    switch (message.type) {
      case 'stream_event': this.streamEvent(message.event); break;
      case 'assistant': this.assistant(message); break;
      case 'user': this.toolResults(message.message.content); break;
      case 'tool_progress': this.toolStatus(message.tool_use_id, message.tool_name, 'running'); break;
      case 'result': this.result = message; break;
      default: break; // system/status/hook/etc. are internal and never reach users
    }
  }

  private newBlock(): Block {
    const block: Block = { blockId: `${this.messageId}.b${this.blockCount++}`, draft: '', final: null };
    this.blocks.push(block);
    return block;
  }
  private appendDraft(block: Block, text: string) {
    if (!text || block.final !== null) return;
    this.observedOutput = true;
    this.length += text.length;
    if (this.length > AGENT_TEXT_LIMIT) throw new AnswerTooLongError();
    block.draft += text;
    if (!this.options.suppressText) this.emit({ type: 'text.delta', blockId: block.blockId, text });
  }

  private streamEvent(event: StreamEvent) {
    switch (event.type) {
      case 'message_start': this.apiMessageId = event.message.id; break;
      case 'content_block_start': {
        const key = `${this.apiMessageId}:${event.index}`;
        if (event.content_block.type === 'text') {
          const block = this.newBlock();
          this.open.set(key, block);
          const list = this.pending.get(String(this.apiMessageId)) ?? [];
          list.push(block); this.pending.set(String(this.apiMessageId), list);
          this.appendDraft(block, event.content_block.text);
        } else if (event.content_block.type === 'tool_use' || event.content_block.type === 'mcp_tool_use') {
          this.toolStatus(event.content_block.id, event.content_block.name, 'started');
        }
        break;
      }
      case 'content_block_delta': {
        // Only visible text deltas; input_json (tool arguments), thinking and signatures are dropped.
        if (event.delta.type !== 'text_delta') break;
        const block = this.open.get(`${this.apiMessageId}:${event.index}`);
        if (block) this.appendDraft(block, event.delta.text);
        break;
      }
      case 'content_block_stop': this.open.delete(`${this.apiMessageId}:${event.index}`); break;
      default: break;
    }
  }

  private assistant(message: AssistantMessage) {
    if (message.error) this.assistantError = message.error;
    // Truncated by our own abort: not authoritative, and the run outcome is "cancelled" anyway.
    if (message.aborted) return;
    // Drafts streamed without an observed message_start are queued under "null" and still match.
    const drafts = this.pending.get(message.message.id) ?? this.pending.get('null') ?? [];
    for (const content of message.message.content) {
      if (content.type === 'text') {
        // Match authoritative blocks to drafts of the same API message in order; a block that was
        // never streamed (no partial events) is announced only by its completion.
        const block = drafts.shift() ?? this.newBlock();
        this.complete(block, content.text);
      } else if (content.type === 'tool_use' || content.type === 'mcp_tool_use') {
        this.toolStatus(content.id, content.name, 'started');
      }
    }
  }

  private complete(block: Block, text: string) {
    if (block.final !== null) return;
    this.observedOutput = true;
    this.length += text.length - block.draft.length;
    if (this.length > AGENT_TEXT_LIMIT) throw new AnswerTooLongError();
    block.final = text;
    if (!this.options.suppressText) this.emit({ type: 'block.completed', blockId: block.blockId, text });
  }

  private toolResults(content: unknown) {
    if (!Array.isArray(content)) return;
    for (const part of content as Array<{ type?: string; tool_use_id?: string; is_error?: boolean }>) {
      if (part.type === 'tool_result' && part.tool_use_id) this.toolStatus(part.tool_use_id, null, part.is_error ? 'failed' : 'succeeded');
    }
  }

  private toolStatus(sdkToolUseId: string, sdkName: string | null, status: ToolStatus) {
    let tool = this.tools.get(sdkToolUseId);
    if (!tool) {
      if (sdkName === null) return; // result for a tool we never saw start (e.g. a subagent's)
      this.observedOutput = true;
      tool = { toolCallId: `${this.messageId}.t${this.toolCount++}`, tool: publicToolName(sdkName), status };
      this.tools.set(sdkToolUseId, tool);
      this.emit({ type: 'tool.status', toolCallId: tool.toolCallId, tool: tool.tool, status: 'started' });
      if (status === 'started') return;
    }
    // Heartbeats and repeated starts collapse: each state is announced at most once, never backwards.
    if (TOOL_STATUS_RANK[status] <= TOOL_STATUS_RANK[tool.status]) return;
    tool.status = status;
    this.emit({ type: 'tool.status', toolCallId: tool.toolCallId, tool: tool.tool, status });
  }

  /**
   * Called after the SDK iterator ends. Returns the authoritative visible answer: the completed
   * blocks joined in order (exactly what was announced), or `result.result` when nothing streamed.
   */
  finish(): string {
    const result = this.checkedResult();
    // Drafts whose authoritative block never arrived are completed from their streamed text.
    for (const block of this.blocks) if (block.final === null && block.draft) this.complete(block, block.draft);
    let completed = this.blocks.filter(b => b.final?.trim()).map(b => b.final!.trim());
    if (!completed.length && result.result.trim()) {
      const block = this.newBlock();
      this.complete(block, result.result.trim());
      completed = [block.final!];
    }
    const text = completed.join('\n\n');
    if (!text) throw new AgentRunFailure('empty_answer');
    return text;
  }

  /**
   * Structured runs: the documented `result.structured_output`. A success without it, and the
   * documented `error_max_structured_output_retries`, are typed failures. The value is returned
   * UNVALIDATED; the server validates its schema and its references before anything is shown.
   */
  finishStructured(): unknown {
    const result = this.checkedResult();
    if (result.structured_output === undefined || result.structured_output === null) throw new AgentRunFailure('analysis_no_output');
    return result.structured_output;
  }

  /** The failure an error `result` already described, if any (single-shot `query()` throws after yielding it). */
  recordedFailure(): AgentRunFailure | null {
    if (!this.result) return null;
    try { this.checkedResult(); return null; } catch (error) { return error as AgentRunFailure; }
  }

  private checkedResult() {
    const result = this.result;
    if (!result) throw new AgentRunFailure('no_result');
    if (result.subtype === 'error_max_structured_output_retries') throw new AgentRunFailure('analysis_retries_exhausted');
    if (result.subtype !== 'success' || result.is_error || this.assistantError) throw new AgentRunFailure(result.subtype === 'success' ? 'model_error' : result.subtype);
    return result;
  }
}
