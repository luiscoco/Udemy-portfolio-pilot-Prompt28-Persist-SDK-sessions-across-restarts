import type { CanUseTool, McpSdkServerConfigWithInstance, Options } from '@anthropic-ai/claude-agent-sdk';
import { PORTFOLIO_TOOL_SERVER_NAME } from './portfolio-tools.js';
import { PORTFOLIO_TOOL_NAMES } from './schemas.js';

/** Fully qualified SDK names: mcp__{server}__{tool}. */
export const PORTFOLIO_ALLOWED_TOOLS: readonly string[] = PORTFOLIO_TOOL_NAMES.map(name => `mcp__${PORTFOLIO_TOOL_SERVER_NAME}__${name}`);
/**
 * Belt and braces: `tools: []` already removes every built-in from the model's context. Bare names here
 * also remove them, so a later change to `tools` cannot silently re-enable filesystem, shell or web access.
 */
export const DISALLOWED_BUILT_IN_TOOLS: readonly string[] = ['Bash', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite', 'Skill'];

/** Deny-by-default permission callback: only our six tools, served by our in-process (sdk) server. */
export const portfolioToolPermissionGuard: CanUseTool = async (toolName, _input, options) => {
  const fromOurServer = !options.mcpServer || (options.mcpServer.source === 'sdk' && options.mcpServer.name === PORTFOLIO_TOOL_SERVER_NAME);
  if (PORTFOLIO_ALLOWED_TOOLS.includes(toolName) && fromOurServer) return { behavior: 'allow' };
  return { behavior: 'deny', message: 'Only the read-only portfolio tools are available in this application.' };
};

/**
 * The documented SDK settings that constrain a run to the portfolio tools: no built-ins, only our
 * in-process MCP server (strictMcpConfig ignores .mcp.json, user settings and plugins), explicit
 * pre-approval, `dontAsk` denial of anything else, and no filesystem settings, skills, agents or plugins.
 */
export function portfolioToolQueryOptions(server: McpSdkServerConfigWithInstance) {
  return {
    tools: [],
    mcpServers: { [PORTFOLIO_TOOL_SERVER_NAME]: server },
    strictMcpConfig: true,
    allowedTools: [...PORTFOLIO_ALLOWED_TOOLS],
    disallowedTools: [...DISALLOWED_BUILT_IN_TOOLS],
    permissionMode: 'dontAsk',
    canUseTool: portfolioToolPermissionGuard,
    settingSources: [],
    skills: [],
    agents: {},
    plugins: []
  } satisfies Options;
}
