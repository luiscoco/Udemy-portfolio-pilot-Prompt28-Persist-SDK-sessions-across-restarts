import { z } from 'zod';
import { agentUsageSchema, chatMessageSchema, chatRunKindSchema } from './chat.js';

/**
 * Application agent-run events (milestone 19). These are OUR typed events, never raw SDK messages.
 * One assistant message per run; every event for it carries the same application `messageId` and a
 * per-message `sequence` that is contiguous from 0, so consumers can drop duplicates and detect gaps.
 */
export const AGENT_TOOL_NAMES = ['getPortfolioSummary', 'listHoldings', 'listTransactions', 'getQuotes', 'searchNews', 'getNewsArticle', 'delegation', 'researchExternal', 'other'] as const;
export const agentToolNameSchema = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;
export const agentRunStatusSchema = z.enum(['queued', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled']);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export const AGENT_TEXT_LIMIT = 16000;

const id = z.string().min(1).max(128);
/** Fields shared by every agent event payload. */
export const agentEventCommonShape = { conversationId: id, messageId: id, sequence: z.number().int().nonnegative().max(100000) };
/** Type-specific payloads. Text is user-visible answer text only; tool status never has arguments or results. */
export const agentEventPayloadShapes = {
  'agent.run.started': { userMessageId: id },
  'agent.text.delta': { blockId: id, offset: z.number().int().nonnegative().max(AGENT_TEXT_LIMIT), text: z.string().min(1).max(8192) },
  'agent.block.completed': { blockId: id, text: z.string().max(AGENT_TEXT_LIMIT) },
  'agent.tool.status': { toolCallId: id, tool: agentToolNameSchema, status: z.enum(['started', 'running', 'succeeded', 'failed']) },
  'agent.message.completed': { message: chatMessageSchema },
  'agent.run.completed': { status: z.enum(['completed', 'failed', 'cancelled']) }
} as const;
export type AgentEventType = keyof typeof agentEventPayloadShapes;
export const AGENT_EVENT_TYPES = Object.keys(agentEventPayloadShapes) as AgentEventType[];

export const agentRunSchema = z.object({
  attempt: z.number().int().nonnegative().default(0),
  heartbeatAt: z.iso.datetime().nullable().default(null),
  leaseExpiresAt: z.iso.datetime().nullable().default(null),
  failureCode: z.string().max(32).nullable().optional(),
  actualModel: z.string().max(128).nullable().optional(),
  usage: agentUsageSchema.nullable().optional(),
  id, conversationId: id, status: agentRunStatusSchema, kind: chatRunKindSchema.default('answer'), userMessageId: id, assistantMessageId: id,
  cancelRequested: z.boolean(), createdAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable()
}).strict();
export type AgentRun = z.infer<typeof agentRunSchema>;
export const agentRunResultSchema = z.object({ run: agentRunSchema });
export const activeAgentRunSchema = z.object({ run: agentRunSchema.nullable() });
/**
 * POST /api/conversations/:id/runs. `replayCursor` is a signed SSE cursor captured BEFORE the run
 * published anything; null when the event stream is unavailable (clients then poll the run).
 */
export const agentRunCreatedSchema = z.object({ run: agentRunSchema, userMessage: chatMessageSchema, replayCursor: z.string().max(2048).nullable() });
