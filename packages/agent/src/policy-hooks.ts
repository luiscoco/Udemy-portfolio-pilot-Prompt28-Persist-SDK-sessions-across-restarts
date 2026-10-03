import { CHANGE_TOOL } from './approval-tools.js';
import type { HookCallback, HookInput, Options } from '@anthropic-ai/claude-agent-sdk';
import { APPLICATION_SKILLS, type ApplicationSkill } from './application-skills.js';
import { DISALLOWED_BUILT_IN_TOOLS } from './tools/options.js';

export interface AuditIdentity { actorId: string; conversationId: string | null; runId: string }
export interface AgentAuditRecord extends AuditIdentity {
  event: 'agent.tool.audit'; time: string; toolName: string;
  outcome: 'allowed' | 'denied' | 'succeeded' | 'failed';
  metadata: { phase: 'pre' | 'post'; subagent: boolean; skill?: ApplicationSkill; redacted: true };
}
export type AuditSink = (record: AgentAuditRecord) => void | Promise<void>;
export const defaultAuditSink: AuditSink = record => { console.info(JSON.stringify(record)); };
const denied = () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const,
  permissionDecisionReason: 'Application policy denied this operation.' } });

/** Exact allowlist and MCP provenance supplement, never replace, owner checks in handlers. */
export function applicationPolicyHooks(options: Options, identity: AuditIdentity, sink: AuditSink = defaultAuditSink,
  now: () => Date = () => new Date()): NonNullable<Options['hooks']> {
  const allowed = options.allowedTools ?? [];
  const previous = options.hooks?.PreToolUse ?? [];
  const record = async (input: HookInput, outcome: AgentAuditRecord['outcome']) => {
    if (!('tool_name' in input)) return;
    const known = [CHANGE_TOOL, ...allowed, ...DISALLOWED_BUILT_IN_TOOLS, 'Skill', 'mcp__portfolio__recordTrade'];
    const args = 'tool_input' in input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input as Record<string, unknown> : {};
    const skill = input.tool_name === 'Skill' && APPLICATION_SKILLS.includes(args.skill as ApplicationSkill) ? args.skill as ApplicationSkill : undefined;
    await sink({ ...identity, event: 'agent.tool.audit', time: now().toISOString(),
      toolName: known.includes(input.tool_name) ? input.tool_name : 'unknown', outcome,
      metadata: { phase: input.hook_event_name === 'PreToolUse' ? 'pre' : 'post', subagent: !!input.agent_id, ...(skill ? { skill } : {}), redacted: true } });
  };
  const pre: HookCallback = async (input, id, context) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const args = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input as Record<string, unknown> : {};
    const write = input.tool_name === CHANGE_TOOL;
    const permitted = write ? !input.agent_id && (!input.mcp_server || (input.mcp_server.name === 'portfolio' && input.mcp_server.source === 'sdk')) : input.tool_name === 'Skill'
      ? !input.agent_id && APPLICATION_SKILLS.includes(args.skill as ApplicationSkill)
      : allowed.includes(input.tool_name) && (!input.mcp_server || (input.mcp_server.name === 'portfolio' && input.mcp_server.source === 'sdk'));
    if (!permitted || context.signal.aborted) { try { await record(input, 'denied'); } catch { /* deny even if logging is down */ } return denied(); }
    // Compose the existing specialist depth/usage policy sequentially; preserve its updatedInput.
    let result: Awaited<ReturnType<HookCallback>> = {};
    for (const matcher of previous) for (const callback of matcher.hooks) {
      try { result = await callback(input, id, context); } catch { return denied(); }
      if ('hookSpecificOutput' in result && result.hookSpecificOutput?.hookEventName === 'PreToolUse' && result.hookSpecificOutput.permissionDecision === 'deny') {
        try { await record(input, 'denied'); } catch { /* preserve policy denial */ } return result;
      }
    }
    try { await record(input, 'allowed'); } catch { return denied(); } // audit unavailable: no execution
    return write ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Explicit application approval required.' } } : result;
  };
  const post: HookCallback = async input => {
    if (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure') return {};
    const response = input.hook_event_name === 'PostToolUse' ? input.tool_response : null;
    const toolError = response && typeof response === 'object' && (response as Record<string, unknown>).isError === true;
    await record(input, input.hook_event_name === 'PostToolUseFailure' || toolError ? 'failed' : 'succeeded');
    return {};
  };
  return { ...options.hooks, PreToolUse: [{ hooks: [pre], timeout: 5 }], PostToolUse: [{ hooks: [post], timeout: 5 }], PostToolUseFailure: [{ hooks: [post], timeout: 5 }] };
}
