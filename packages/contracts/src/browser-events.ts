import { z } from 'zod';
import { agentEventCommonShape, agentEventPayloadShapes, type AgentEventType } from './agent-events.js';

const base = { id: z.uuid(), schemaVersion: z.literal(1), occurredAt: z.iso.datetime() };
const resource = z.string().min(1).max(128);
// Agent events: application run/message/block IDs and a per-message sequence; never SDK envelopes.
function agentBrowserEvent<T extends AgentEventType>(type: T) {
  return z.object({ ...base, type: z.literal(type), runId: resource, ...agentEventCommonShape, ...agentEventPayloadShapes[type] }).strict();
}
// Strict public allowlist: no audiences, session tokens, provider/SDK envelopes or tool arguments.
export const browserEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('research.updated'), resourceId: resource,
    change: z.enum(['recommendation.created', 'recommendation.updated', 'notification.created', 'notification.dismissed', 'rule.updated']) }).strict(),
  z.object({ ...base, type: z.literal('portfolio.updated'), portfolioId: resource,
    change: z.enum(['created', 'renamed', 'archived', 'transaction.recorded']), transactionId: resource.nullable() }).strict(),
  z.object({ ...base, type: z.literal('watchlist.updated'), entryId: resource,
    change: z.enum(['added', 'changed', 'removed']), securityId: resource.nullable() }).strict(),
  z.object({ ...base, type: z.literal('news.available'), articleId: resource,
    change: z.enum(['new', 'correction']), securityIds: z.array(resource).max(1000), portfolioIds: z.array(resource).max(1000), watchlisted: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal('quote.updated'), quotes: z.array(z.object({ securityId: resource, asOf: z.iso.datetime() }).strict()).max(1000) }).strict(),
  agentBrowserEvent('agent.run.started'), agentBrowserEvent('agent.text.delta'), agentBrowserEvent('agent.block.completed'),
  agentBrowserEvent('agent.tool.status'), agentBrowserEvent('agent.message.completed'), agentBrowserEvent('agent.run.completed'),
  z.object({ ...base, type: z.literal('stream.reset'), reason: z.enum(['snapshot_required', 'invalid_cursor', 'expired', 'trimmed', 'epoch_changed', 'unavailable', 'slow_client']),
    recoveryUrl: z.literal('/api/events/recovery') }).strict()
]);
export type BrowserEvent = z.infer<typeof browserEventSchema>;

export const agentRunChunksSchema = z.object({ events: z.array(browserEventSchema).max(514) });
