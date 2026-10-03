import { tool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { proposedChangeSchema } from '@portfolio-pilot/contracts';
import type { PortfolioToolContext } from './tools/context.js';
export const ALERT_READ_TOOL = 'mcp__portfolio__listAlertRules';
export const CHANGE_TOOL = 'mcp__portfolio__proposeChange';
export function createApprovalTools(context: PortfolioToolContext) {
 if (!context.approval) return [];
 return [tool('listAlertRules', 'Read up to twenty alert rules owned by the signed-in user, including their IDs, revisions and complete current settings. Read before proposing an alert rule replacement.', {}, async () => {
 const rules = await context.approval!.rules();
 return { content: [{ type: 'text' as const, text: JSON.stringify({ rules }) }], structuredContent: { rules } };
 }, { annotations: { readOnlyHint: true, idempotentHint: true }, alwaysLoad: true }), tool('proposeChange', 'Propose an exact watchlist addition or replacement of an alert rule. The application asks the signed-in user for approval before executing. Model intent is never authorization. For alert.update, use the existing rule ID and revision and supply the complete replacement rule. Never claim a change happened until applied=true.',
  { actionType: z.enum(['watchlist.add','alert.update']), arguments: z.record(z.string(), z.unknown()) }, async args => {
   try {
    if (context.signal?.aborted) throw new Error('Cancelled');
    const change = proposedChangeSchema.parse(args);
    const receipt = await context.approval!.execute(change);
    return { content: [{ type: 'text' as const, text: JSON.stringify(receipt) }], structuredContent: receipt };
   } catch { return { isError: true, content: [{ type: 'text' as const, text: 'Change was not applied. A current, exact, unexpired user approval is required.' }] }; }
  }, { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, alwaysLoad: true })];
}
/** No write in allowedTools. PreToolUse asks, documented canUseTool waits; handler rechecks receipt. */
export function applicationApprovalOptions(options: Options, context: PortfolioToolContext): void {
 if (!context.approval) return;
 options.allowedTools = [...(options.allowedTools ?? []), ALERT_READ_TOOL];
 const prior = options.canUseTool;
 options.permissionMode = 'default';
 options.canUseTool = async (name, args, info) => {
  if (name !== CHANGE_TOOL) return prior ? prior(name, args, info) : { behavior: 'deny', message: 'Unavailable tool.' };
  if (info.mcpServer && (info.mcpServer.name !== 'portfolio' || info.mcpServer.source !== 'sdk')) return { behavior: 'deny', message: 'Untrusted tool source.' };
  try {
   const change = proposedChangeSchema.parse(args);
   if (await context.approval!.authorize(change, info.signal)) return { behavior: 'allow', updatedInput: change };
  } catch { /* deny safely without leaking arguments or backend errors */ }
  return { behavior: 'deny', message: 'The proposed change was not approved.', interrupt: true };
 };
}
