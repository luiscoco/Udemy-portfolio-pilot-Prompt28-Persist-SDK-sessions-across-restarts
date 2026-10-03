# 24 - Reusable application skills and policy hooks

## Outcome

Daily briefings and earnings reviews reuse application instructions from a managed runtime. Policy
hooks reject forbidden operations, while tools independently enforce ownership. Audit events join
the authenticated actor, conversation and persisted run without exposing inputs or hidden reasoning.

## Skill versus executable tool

`daily-portfolio-briefing/SKILL.md` tells Claude which evidence to fetch and which headings to use:

1. As of and coverage
2. Portfolio snapshot
3. Relevant news
4. Risks and uncertainties
5. Research follow-ups

`earnings-news-review` asks for reported facts, portfolio exposure, interpretation/counterarguments,
and uncertainties/follow-up research. Neither artifact contains code, executable resources, shell
expansions or permission grants. `getPortfolioSummary` and `getNewsArticle` execute the reads;
their Zod schemas, decimal calculations, freshness labels and owner-bound repositories remain the
authorization boundary. A skill never gains filesystem access or permission to trade.

The answer says `Skill used: daily-portfolio-briefing` or `Skill used: earnings-news-review`.
Live audit additionally records the Skill invocation and its outcome. A mock answer explicitly says
`mock skill simulation`: it reads the same managed artifact, checks its headings and deterministically
renders authorized data. This is not proof of native model behavior.

## Isolated configuration

Source artifacts are in `packages/agent/runtime/skills`, outside the coding assistant's instruction
directories. Live chat installs them under the explicit, clean, absolute `AGENT_WORKSPACE_DIR`:

```text
<application-runtime>/
  skills/daily-portfolio-briefing/SKILL.md
  skills/earnings-news-review/SKILL.md
  projects/...                    # sensitive host-local SDK session artifacts
```

SDK `cwd` and `CLAUDE_CONFIG_DIR` both point there. `settingSources=['user']` deliberately loads only
this **overridden application configuration source**. It does not load personal home settings.
Project/local sources are absent, so ancestor project settings/CLAUDE.md do not participate.
`skills` lists exactly two names; `plugins=[]`, strict SDK MCP configuration and disabled cloud
skill/plugin sync exclude personal integrations. `Skill` is the only newly enabled main tool;
shell, filesystem, web and mutation tools stay denied. Specialists cannot load skills. Article
analysis still uses `settingSources=[]` and no tools or skills.

Do not select an existing developer configuration directory. Unmanaged settings/plugins/skills and
changed instruction bytes are rejected. No existing instructions are overwritten. For a skill
upgrade choose a fresh runtime directory and update the application runtime version. The model
configuration key makes existing conversation sessions reseed honestly.

## Policy and audit

`PreToolUse` verifies exact tool/skill names and SDK MCP origin, then applies any specialist policy.
`PostToolUse` and `PostToolUseFailure` record outcomes; tool-level `isError` also counts as failure.
An allowed policy check is not proof of ownership. The acceptance test lets Bob pass the generic
read policy, then observes the owner-bound tool rejecting Alice's portfolio and a failed audit.

The server passes `actorId`, `conversationId`, and `runId` from authenticated/persisted context.
Audit JSON looks like this (illustrative IDs):

```json
{"actorId":"demo-alice","conversationId":"conversation-24","runId":"run-24","event":"agent.tool.audit","time":"2026-10-02T12:00:00.000Z","toolName":"Skill","outcome":"succeeded","metadata":{"phase":"post","subagent":false,"skill":"daily-portfolio-briefing","redacted":true}}
```

Arguments, result text, raw errors, SDK paths/session IDs, credentials and reasoning are discarded,
not recursively logged. Unknown tool names become `unknown` to prevent arbitrary names from leaking
payloads. Server logs are the default sink; durable audit retention is not implemented here.
Audit failure before execution denies the operation; a post-tool logging failure cannot undo a read.

## Demonstration

With the existing local PostgreSQL/Redis and seeded demo ready:

```powershell
npm run build:types
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:DEMO_AUTH_ENABLED='true'
npm run dev
```

Use the configured loopback origin and local AUTH_SECRET from the authentication lesson. In the
React app, sign in as Alice, open Assistant, create a conversation scoped to Growth, and ask
`Give me a daily portfolio briefing`. Inspect the five headings, UTC/freshness and mock labels,
cited stored news or explicit absence, and research follow-ups. Ask `Review earnings news` for
the four earnings headings. Reload to confirm the answer is persisted. In API stdout, filter
`agent.tool.audit` for the returned run ID; the Skill and application read events correlate to it.

Automated checks:

```powershell
npm run test -w @portfolio-pilot/agent -- test/skills-policy.test.ts
# Existing migrated disposable database; guard requires loopback *_verify.
$env:AGENT_TOOLS_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m22_verify'
npm run test -w @portfolio-pilot/api -- lib/agent-tools.integration.test.ts
```

The first suite checks briefing structure, earnings structure, empty news/missing quotes, forbidden
`Bash` and `mcp__portfolio__recordTrade`, fake MCP provenance, unknown skills, redaction, unavailable
audit sinks and specialist policy composition. It boots the actual SDK from an empty directory with
planted personal settings/plugins/MCP and ancestor skills/instructions. Its streaming input sends no
prompt: startup discovery and hook registration cost no model tokens and require no credentials.
The second suite uses actual PostgreSQL ownership, valuation and stored-news records.

Optional native model acceptance, only after supplying an authorized API key, verified model ID
and a clean absolute runtime directory outside the repository/personal agent configuration:

```powershell
$env:RUN_LIVE_SKILLS_TEST='true'
npm run test -w @portfolio-pilot/agent -- test/skills.live.test.ts
Remove-Item Env:RUN_LIVE_SKILLS_TEST
```

One live run has a $0.10 SDK spend cap, ten-turn cap and 60-second timeout. The live test checks
actual Skill completion, ordered briefing headings and correlated audit. It remains unexecuted here
because credentials/model configuration are unavailable. It uses synthetic owner-bound fixtures.

Windows verification used the installed Node 24.21.0 binary with its adjacent npm-cli.js and that
installation prepended to PATH. Prisma's cache timestamp operation needed the existing documented
`PRISMA_SCHEMA_ENGINE_BINARY` workaround. See the state report for actual results.

## Exercise

Add an instruction to an article that asks the assistant to run Bash. Observe the forbidden hook
fixture denying Bash independently of model obedience. Then try a foreign portfolio ID: the generic
read policy allows its tool name, but the handler still rejects ownership. Explain why neither a
skill nor a hook is a substitute for authorization inside the tool.

Official references and the trust boundary are recorded in [ADR 0017](../decisions/0017-managed-application-skills-and-audit.md).
