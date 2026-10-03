import { createApprovalTools } from './approval-tools.js';
import type { AgentDefinition, HookCallback, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { NEWS_SPECIALIST_PROMPT, RISK_SPECIALIST_PROMPT } from './instructions/specialists.js';
import { DISALLOWED_BUILT_IN_TOOLS, PORTFOLIO_ALLOWED_TOOLS, portfolioToolQueryOptions } from './tools/options.js';
import { createPortfolioTools, PORTFOLIO_TOOL_SERVER_NAME } from './tools/portfolio-tools.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createExternalResearchTool, type ResearchMcpConfig } from './research-mcp.js';
import type { PortfolioToolContext } from './tools/context.js';
import { AgentRunFailure } from './errors.js';

const fq = (name: string) => `mcp__portfolio__${name}`;
export const SPECIALIST_NAMES = ['news-research', 'portfolio-risk'] as const;
export const DELEGATION_ENV = { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1', CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '2', CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1' } as const;
export function specialistDefinitions(external: boolean): Record<string, AgentDefinition> {
  const common = { model: 'inherit', maxTurns: 3, background: false, omitClaudeMd: true, skills: [], disallowedTools: [...DISALLOWED_BUILT_IN_TOOLS] };
  return {
    'news-research': { ...common, description: 'Research relevant stored news and optional public research context.', prompt: NEWS_SPECIALIST_PROMPT,
      tools: ['searchNews', 'getNewsArticle', ...(external ? ['researchExternal'] : [])].map(fq), mcpServers: ['portfolio'] },
    'portfolio-risk': { ...common, description: 'Assess current holdings, concentration and valuation coverage.', prompt: RISK_SPECIALIST_PROMPT,
      tools: ['getPortfolioSummary', 'listHoldings'].map(fq), mcpServers: ['portfolio'] }
  };
}
/** PreToolUse is required: preapproved allowedTools do not necessarily invoke canUseTool. */
export function delegationOptions(context: PortfolioToolContext, external?: ResearchMcpConfig): Options {
  const definitions = specialistDefinitions(!!external);
  const seen = new Set<string>();
  let toolCalls = 0;
  const policy: HookCallback = async hook => {
    if (hook.hook_event_name !== 'PreToolUse') return {};
    const deny = () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: 'Research policy denied this operation.' } });
    if (context.signal?.aborted || ++toolCalls > 24) return deny();
    if (hook.tool_name === 'Agent' || hook.tool_name === 'Task') {
      const args = hook.tool_input as Record<string, unknown> | null;
      const name = args?.subagent_type;
      if (hook.agent_id || typeof name !== 'string' || !SPECIALIST_NAMES.includes(name as typeof SPECIALIST_NAMES[number]) || seen.has(name) || args?.resume || args?.isolation) return deny();
      if (typeof args?.prompt !== 'string' || args.prompt.length > 6000) return deny();
      seen.add(name);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { subagent_type: name, prompt: args.prompt,
        description: name, run_in_background: false } } };
    }
    const permitted = hook.agent_id ? definitions[hook.agent_type ?? '']?.tools ?? [] : [...PORTFOLIO_ALLOWED_TOOLS, 'mcp__portfolio__proposeChange', 'mcp__portfolio__listAlertRules', 'Skill', ...(external ? [fq('researchExternal')] : [])];
    if (!permitted.includes(hook.tool_name) || (hook.mcp_server && (hook.mcp_server.source !== 'sdk' || hook.mcp_server.name !== 'portfolio'))) return deny();
    return {};
  };
  const server = createSdkMcpServer({ name: PORTFOLIO_TOOL_SERVER_NAME, version: '1.0.0', alwaysLoad: true, timeout: 15000,
    tools: [...createPortfolioTools(context), ...createApprovalTools(context), ...(external ? [createExternalResearchTool(context, external)] : [])] });
  return { ...portfolioToolQueryOptions(server), tools: ['Agent'], agents: definitions,
    allowedTools: [...PORTFOLIO_ALLOWED_TOOLS, 'Agent', ...(external ? [fq('researchExternal')] : [])],
    disallowedTools: DISALLOWED_BUILT_IN_TOOLS.filter(t => t !== 'Agent' && t !== 'Task'),
    hooks: { PreToolUse: [{ hooks: [policy], timeout: 5 }] },
    canUseTool: async () => ({ behavior: 'deny', message: 'Only application policy approved tools are permitted.' }) };
}

export type ResearchUsage = { complete?: boolean; turns?: number; costUsd: number; mainInputTokens: number; mainOutputTokens: number; aggregateTokens: number; durationMs: number; apiDurationMs: number; modelUsage: Extract<SDKMessage, { type: 'result' }>['modelUsage'] };
export function reportedResearchUsage(message: SDKMessage): ResearchUsage | null {
  if (message.type !== 'result') return null;
  // Legacy test seams may omit telemetry. Actual installed SDK results declare all these fields.
  if (!message.modelUsage || !message.usage) return null;
  const values = Object.values(message.modelUsage);
  return { complete: message.subtype !== 'error_during_execution' && values.length > 0, turns: message.num_turns, costUsd: message.total_cost_usd, mainInputTokens: message.usage.input_tokens, mainOutputTokens: message.usage.output_tokens,
    aggregateTokens: values.reduce((sum, u) => sum + u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0),
    durationMs: message.duration_ms, apiDurationMs: message.duration_api_ms, modelUsage: message.modelUsage };
}
export function enforceReportedUsage(usage: ResearchUsage, costCap: number, tokenCap: number) {
  if (!Number.isFinite(usage.costUsd) || !Number.isFinite(usage.aggregateTokens) || usage.costUsd < 0 || usage.aggregateTokens < 0 || usage.costUsd > costCap || usage.aggregateTokens > tokenCap)
    throw new AgentRunFailure('error_max_budget_usd');
}
