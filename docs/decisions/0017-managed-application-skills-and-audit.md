# 0017. Managed application skills and policy audit

- Status: Accepted
- Date: 2026-10-02
- Milestone: 24

## Decision

Ship two reviewed Markdown artifacts under `packages/agent/runtime/skills`: daily portfolio
briefing and earnings-news review. They are application prompt instructions, never coding-agent
skills or project instructions. Live chat copies their exact bytes to `AGENT_WORKSPACE_DIR/skills`.
The absolute workspace must be outside the source repository and personal `.claude`, `.codex` and
`.agents` configuration. Existing unmanaged configuration, unexpected skill resources, symlinks
and modified instructions cause rejection rather than overwriting instructions. Upgrade by selecting
a new managed directory; session configuration includes `skills-policy-v1` so old sessions reseed.

Use explicit `cwd=AGENT_WORKSPACE_DIR`, `CLAUDE_CONFIG_DIR=AGENT_WORKSPACE_DIR` and
`settingSources=['user']`. In the SDK, `user` here resolves to the **application's overridden config
directory**, not the developer's personal directory. Project and local sources are excluded to avoid
ancestor CLAUDE.md, settings and skills. Personal configuration remains separate. Empty plugins,
disabled cloud skill/plugin sync, exact skills names, strict application MCP configuration,
`dontAsk`, restricted built-ins and the existing safe child environment remain explicit. The only
new main-thread built-in is `Skill`; filesystem, shell and web tools stay disabled. Specialists keep
their narrower tools and cannot invoke skills. Shared public article analysis continues with no
settings sources, skills or tools.

The current official skills documentation describes automatic discovery from enabled filesystem
sources, exact `skills` names and including `Skill` in an explicit `tools` list. Installed SDK
0.3.276 types support these options and synchronous PreToolUse/PostToolUse/PostToolUseFailure hooks.
Actual credential-free CLI initialization discovers both skills, registers hooks and omits planted
personal and ancestor skills/MCP configuration. The test supplies no prompt, so no model call occurs.

Pre-tool policy uses exact application tool names and SDK MCP provenance. Compose the prior
specialist policy sequentially, preserving its denial and updated input. Skills are allowed only
for the two managed main-thread names. Unknown tools and mutation/trade operations fail closed.
Hook approval does not validate ownership: handlers still validate schemas and owner repositories.
The real PostgreSQL acceptance test deliberately gets a policy-approved read that fails ownership.

Audit identity comes from authenticated server context and persisted run/conversation IDs. Record
UTC time, tool name, allowed/denied/succeeded/failed and allowlisted phase/subagent/skill metadata.
Arbitrary tool names become `unknown`; a fixed forbidden trade sentinel is preserved. Do not record
SDK paths, prompts, arguments, results, error strings, raw SDK messages, session IDs or reasoning.
The default sink writes JSON server audit events; an injectable asynchronous sink supports tests
and later collection. Pre-tool audit failure denies execution. Post-tool audit cannot undo reads.
There is no new browser event carrying private audit identity or SDK internals.

## Consequences

Skills guide answer organization; tools execute validated reads. The deterministic mock follows
the managed headings, invokes the same tool handlers, and replays the policy/audit callbacks.
Its answer explicitly labels skill simulation. Skill selection in a live model is still model-driven;
an opt-in bounded live acceptance test checks invocation and briefing structure. Directory separation
is configuration isolation, not an OS sandbox. Server operators must protect runtime files; transcripts
remain sensitive, host-local SDK artifacts. Audit collection/retention and distributed execution are
later milestones. Native model adherence is unverified without credentials.

## References

Checked 2026-10-02 against installed `@anthropic-ai/claude-agent-sdk` 0.3.276 types and bundled CLI
2.1.276, without upgrading dependencies:

- [SDK skills and configuration sources](https://code.claude.com/docs/en/agent-sdk/skills)
- [SDK hooks and permission decisions](https://code.claude.com/docs/en/agent-sdk/hooks)
- [Configuration location and precedence](https://code.claude.com/docs/en/settings)

The current TypeScript reference endpoint could not be retrieved by the browser tool; installed
`sdk.d.ts` is the checked API reference for Options, HookInput, HookCallback, initializationResult,
supportedCommands and mcpServerStatus. Startup behavior was verified with the installed subprocess.
