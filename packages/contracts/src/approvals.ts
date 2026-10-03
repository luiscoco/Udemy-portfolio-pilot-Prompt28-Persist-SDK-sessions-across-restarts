import { z } from 'zod';
import { alertRuleWriteSchema } from './alerts.js';
const id = z.string().min(1).max(128);
export const proposedChangeSchema = z.discriminatedUnion('actionType', [
  z.object({ actionType: z.literal('watchlist.add'), arguments: z.object({ symbol: z.string().regex(/^[A-Z][A-Z0-9.\-]{0,31}$/), exchangeMic: z.string().regex(/^[A-Z0-9]{4}$/) }).strict() }).strict(),
  z.object({ actionType: z.literal('alert.update'), arguments: z.object({ ruleId: id, expectedRevision: z.number().int().positive(), rule: alertRuleWriteSchema }).strict() }).strict()
]);
export type ProposedChange = z.infer<typeof proposedChangeSchema>;
export const approvalSchema = z.object({ id, runId: id, actionType: z.enum(['watchlist.add', 'alert.update']), arguments: z.record(z.string(), z.unknown()), argumentHash: z.string().length(64), mutationId: id,
 status: z.enum(['pending','approved','consumed','rejected','expired','cancelled','invalidated']), expiresAt: z.iso.datetime(), createdAt: z.iso.datetime(), before: z.record(z.string(), z.unknown()) });
export const approvalListSchema = z.object({ approvals: z.array(approvalSchema) });
export const approvalResultSchema = z.object({ approval: approvalSchema });
export const approvalDecisionSchema = z.object({ argumentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
