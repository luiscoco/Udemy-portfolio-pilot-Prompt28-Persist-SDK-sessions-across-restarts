# 0016. Bounded specialists and external research MCP

- Status: Accepted
- Date: 2026-10-02
- Milestone: 23

## Context

Research benefits from separate news and holdings reports. Delegation must preserve the authenticated
data capability and the main agent's responsibility for a cited answer. External research must not
become a route to private portfolio data, arbitrary servers or application credentials.

## Decision

Default to the existing single-agent path. Opt in through validated server configuration. Native
SDK `AgentDefinition` defines news-research (stored news plus optional external research) and
portfolio-risk (summary and holdings). Both use the same owner-bound in-process MCP data port.
No identity is supplied by a model. Successful article reads still populate the existing run-local
evidence registry. The main agent composes the final answer and existing citation validation applies.

Set SDK depth 1/concurrency 2; disable built-in agents. A narrow PreToolUse policy permits one
foreground invocation per named specialist, prohibits nesting/resume/isolation and caps all tool
attempts at 24. Each specialist gets three turns; main defaults remain six turns, $0.10 and 60 seconds.
The callback is necessary even for preapproved tools. General audit/skills policy remains milestone 24.

Reconcile reported `total_cost_usd` and `modelUsage` independently of main-loop `usage`. Check aggregate
tokens (including cache tokens) against 100,000 and cost against the configured SDK cap. During the
run, complete assistant-message usage is observed across parent and child contexts, with per-message
maximums to avoid counting repeated blocks twice. A breached bound closes the query. These are
response-boundary limits: already issued requests can overshoot, and abort/crash can leave usage
incomplete. Daily atomic reservations and durable reconciliation belong to milestone 26.

Expose only application delegation/tool states via existing SSE. Suppress complete child reports
and reasoning from browser streams. Subagent token deltas are not forwarded by this SDK; no claim
of specialist token streaming is made.

The external integration is a stdio Node.js process wrapped by `researchExternal`, not a direct
SDK-configured remote server. Its only allowlisted call is `researchSecurity(symbol, exchangeMic)`.
Resolve the security through the owner port first. The fixture runs without authentication over a
private process pipe. Live mode requires a reviewed absolute script path and dedicated
`RESEARCH_MCP_TOKEN`; the server must enforce that credential itself. No model can select a command,
path or endpoint. Only safe OS environment defaults and the dedicated token reach the child.
The Claude subprocess also receives safe OS defaults plus its Claude credential, not the app's secrets.

Bound external calls to two, deadline to three seconds by default (ten seconds maximum), transport
buffer to 32 KiB, full result to 12,000 bytes and schema to five entries. Abort, protocol errors,
auth failure, invalid output and oversize return one fixed failure. No automatic retry, arbitrary
tool discovery, sampling or remote OAuth flow is enabled. Supplementary public context is untrusted
and cannot register an application article citation. Fixture output must declare itself synthetic.

## Alternatives considered

Direct remote HTTP MCP configuration is supported by the SDK, but does not provide our in-handler
ownership and response bounds. An application-owned stdio adapter offers a repeatable lesson and
a controlled live bridge without adding network endpoint selection to model tools.
Application-created independent Claude queries were rejected in favor of verified native subagents.

## Consequences

The deterministic mock simulates both specialists and uses the real external MCP process. It consumes
zero model tokens; its latency comparison measures application/tool overhead only. A separately
gated live experiment records SDK aggregate usage and confirms both delegations. It has not run
without credentials. A reviewed live script is trusted server code, not an OS sandbox; it must not
read private application files or log tokens. Packaging the fixture into production images remains
part of milestone 33. Sessions change configuration keys when specialists/MCP mode change.

## Verified references

Checked 2026-10-02: installed Claude Agent SDK 0.3.276 `sdk.d.ts` (`AgentDefinition`, `Options`,
`PreToolUseHookInput`, result `modelUsage`, `ModelUsage`) and manifest CLI 2.1.276. Installed MCP SDK
1.31.0 client/stdio, shared/stdio and server/mcp types and implementations were inspected.
No dependency version upgrade.

- [SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- [SDK cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
- [SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)
- [SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)
- [SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Official MCP SDK v1](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
