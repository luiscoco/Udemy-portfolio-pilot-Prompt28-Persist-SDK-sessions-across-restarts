import { z } from 'zod';
import { newsAnalysisSchema } from './news-analysis.js';

export function validatedSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export const chatSourceSchema = z.object({
  articleId: z.string().min(1).max(128), title: z.string().max(500),
  url: z.string().max(2048).refine(value => validatedSourceUrl(value) !== null),
  publishedAt: z.iso.datetime(), isSynthetic: z.boolean()
}).strict();
export type ChatSource = z.infer<typeof chatSourceSchema>;
export const conversationCreateSchema = z.object({ title: z.string().trim().min(1).max(100).default('Portfolio research'), portfolioId: z.string().min(1).max(128).nullable().default(null) }).strict();
export const conversationSchema = z.object({ id: z.string(), title: z.string(), portfolioId: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export type Conversation = z.infer<typeof conversationSchema>;
export const chatRunKindSchema = z.enum(['answer', 'news_analysis']);
export type ChatRunKind = z.infer<typeof chatRunKindSchema>;
/**
 * How an assistant answer relates to the SDK session (milestone 20). Application chat history in
 * PostgreSQL is always complete; this says whether the MODEL saw it through a resumed SDK session or
 * only through a bounded, server-built summary in a new session.
 * - `new`: first turn of the conversation, new SDK session.
 * - `resumed`: the recorded SDK session was resumed with the documented `resume` option.
 * - `reseeded`: no usable SDK session; a new one was seeded from an authorized summary.
 */
export const SESSION_CONTINUITY_REASONS = ['not_recorded', 'session_missing', 'not_local', 'configuration_changed', 'resume_failed', 'context_limit'] as const;
export const sessionContinuitySchema = z.object({
  disposition: z.enum(['new', 'resumed', 'reseeded']),
  reason: z.enum(SESSION_CONTINUITY_REASONS).nullable()
}).strict();
export type SessionContinuity = z.infer<typeof sessionContinuitySchema>;
export const agentUsageSchema = z.object({
  accounting: z.enum(['sdk_estimate', 'conservative', 'mock', 'not_started']),
  estimatedCostUsd: z.string().regex(/^\d+\.\d{6}$/),
  aggregateTokens: z.number().int().nonnegative(), turns: z.number().int().nonnegative(), resultCount: z.number().int().nonnegative()
}).strict();
export type AgentUsage = z.infer<typeof agentUsageSchema>;
export const chatMessageSchema = z.object({
  usage: agentUsageSchema.nullable().optional(),
  actualModel: z.string().max(128).nullable().optional(),
  id: z.string(), conversationId: z.string(), role: z.enum(['user', 'assistant']), content: z.string().max(16000),
  status: z.enum(['completed', 'failed', 'cancelled']), mode: z.enum(['mock', 'claude']).nullable(),
  instructionVersion: z.string().nullable(), sources: z.array(chatSourceSchema).max(30), createdAt: z.iso.datetime(),
  kind: chatRunKindSchema.default('answer'),
  /** Server-validated structured analysis; null for ordinary answers and failures. */
  analysis: newsAnalysisSchema.nullable().default(null),
  continuity: sessionContinuitySchema.nullable().default(null)
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatMessageCreateSchema = z.object({ content: z.string().trim().min(1).max(2000), kind: chatRunKindSchema.default('answer') }).strict();
export const chatPageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().min(1).max(128).optional() }).strict();
export const conversationResultSchema = z.object({ conversation: conversationSchema });
export const conversationPageSchema = z.object({ conversations: z.array(conversationSchema), nextBefore: z.string().nullable() });
export const messagePageSchema = z.object({ messages: z.array(chatMessageSchema), nextBefore: z.string().nullable() });
