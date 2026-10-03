# Lesson 23 — Focused specialists and bounded research MCP

## Outcome

Enable optional news-research and portfolio-risk specialists while keeping the main agent responsible
for the final cited answer. Every private read uses the authenticated owner's capability. External
public context goes through one bounded tool. The deterministic demo needs no market or AI credentials.

Policy and verified APIs: [ADR 0016](../decisions/0016-bounded-specialists-and-research-mcp.md).
The installed SDK is 0.3.276 (CLI manifest 2.1.276); MCP SDK remains 1.31.0. Check installed types
before changing options. Official references are linked in the ADR.

## Repeatable local demo

Use the database/seed and authentication setup from lesson 22. Build the shared packages before
starting: the external fixture is a compiled Node.js process, including when the API runs in dev mode.

```powershell
npm run build:types
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:AGENT_SPECIALISTS_ENABLED='true'
$env:RESEARCH_MCP_MODE='fixture'
npm run dev
```

Open `http://localhost:5173/assistant`, sign in as Alice using demo authentication, create a
conversation scoped to Growth, and ask **Research recent news and portfolio risk**. Observe two
sanitized specialist progress rows and external research status. The final mock answer contains
stored article citations, a news evidence report and a bounded holdings/concentration sample.
It explicitly labels the specialist simulation and synthetic data. Child reports/reasoning are not
streamed as user answer blocks. Reload to inspect the persisted final answer and sources.

Sign in as Bob. Alice's conversation remains inaccessible. The acceptance test also tries Alice's
portfolio/article/security IDs directly through every specialist/MCP tool and receives a failure.

For the simple path, restart with `AGENT_SPECIALISTS_ENABLED=false` and `RESEARCH_MCP_MODE=off`.
Specialists are optional; plain non-research questions use the simple mock planner even when enabled.
Structured analysis retains its existing schema validation; the live main agent may consult specialists
but emits the validated structured answer itself. Mock structured analysis uses its existing planner.

## External server contract and authentication

Fixture mode starts `packages/agent/dist/fixture-research-server.js` over private stdio using the
current Node executable. It exposes exactly `researchSecurity({symbol, exchangeMic})`.
There is no network listener or fixture credential. Every fixture entry is synthetic.

Live mode starts an **operator-reviewed absolute Node.js script**, using the same stdio transport:

```powershell
$env:AGENT_SPECIALISTS_ENABLED='true'
$env:RESEARCH_MCP_MODE='live'
$env:RESEARCH_MCP_SCRIPT_PATH='C:\reviewed-research-server\server.mjs'
# Set RESEARCH_MCP_TOKEN securely in server configuration; use a separate research-only credential.
# Start/restart the API after configuring it.
```

The script must register `researchSecurity`, enforce its dedicated `RESEARCH_MCP_TOKEN`, and return
MCP `structuredContent` with this shape (text content may duplicate it):

```json
{
  "evidence": [{
    "source": "Publisher",
    "title": "Public research context",
    "summary": "Supported public facts only",
    "publishedAt": "2026-10-02T12:00:00.000Z",
    "url": "https://publisher.example/research",
    "synthetic": false
  }]
}
```

The app validates five entries maximum, HTTPS URLs without embedded credentials, bounded text, a
12,000-byte full response and a 32 KiB transport buffer. The deadline is 3 seconds by default;
two external calls maximum per live agent run. Failures are fixed messages, with no automatic retry.
No model-supplied URL, command, token, user ID or free-text question is exported. The app first
resolves security membership through the owner port and sends only symbol/exchange. The child inherits
safe OS environment defaults and the dedicated research token, never the database/auth/Claude/provider
credentials. A reviewed script is trusted server code, not a filesystem sandbox. Its provider endpoint
must be operator-configured. Remote HTTP/SSE and interactive OAuth are not implemented here.

External context is supplementary untrusted evidence. It does not create internal article IDs or
registered citation links; the final answer must still cite stored articles actually read.

## Limits and truthful usage

Depth is one, concurrency two, and there is one foreground invocation per specialist per run. The
policy denies additional/nested/resumed specialist calls and enforces role tool allowlists even for
preapproved tools. The same owner context and cancellation signal reach every handler.

SDK cost cap defaults to $0.10 and includes subagent spend according to the verified current docs.
The app separately checks observed complete-message token usage and final aggregate `modelUsage`
against 100,000 tokens, including cache reads/creation. Main-loop tokens are recorded separately.
Delegated results missing aggregate telemetry fail closed. Counters cannot know unreported work after
abort/crash. Checks apply at response boundaries and can overshoot by in-flight requests. Do not use
this as a daily-user reservation system; that is milestone 26.

The SDK does not forward subagent token deltas. The application reports sanitized delegation status
and streams only the main answer. It suppresses hidden reasoning, arguments and complete child text.

## Tests and measurements

```powershell
npm run build:types
npm run test -w @portfolio-pilot/agent
npm run test -w @portfolio-pilot/config
$env:AGENT_TOOLS_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m22_verify'
$env:DATA_MODE='mock'
npm run test -w @portfolio-pilot/api -- lib/agent-tools.integration.test.ts
npm run typecheck
npm run lint
npm run build
npm run check:browser-boundary
```

The agent test writes `packages/agent/test-results/m23-comparison.json`. On this host, the final
focused run measured single **3 ms / 3 owner-port calls** and delegated fixture **399 ms / 8 calls**.
Both consumed **0 model tokens / $0**. This measures mock orchestration and real process/transport
overhead; it is not evidence that native delegation has these timings or saves tokens. Results vary
with process startup and test concurrency. The hostile server tests cover hanging calls, transport
overflow, response overflow, invalid URLs, rejected credentials, cancellation and environment isolation.

The optional paid live experiment starts fresh sessions for each path and writes
`packages/agent/test-results/m23-live-comparison.json` with wall time, SDK duration/API time, main
tokens, aggregate cached/noncached tokens, total cost and per-model usage. It checks two successful
delegations and aggregate tokens exceeding the main loop. No prompts or private output are recorded.
It uses synthetic owner-bound data and fixture MCP for both repeatability and credential isolation.
Provide an authorized Claude API key, verified model ID and isolated absolute SDK workspace first:

```powershell
# Securely set ANTHROPIC_API_KEY, AGENT_MODEL_ID, AGENT_WORKSPACE_DIR.
$env:RUN_LIVE_RESEARCH_COMPARE='true'
npm run test -w @portfolio-pilot/agent -- test/research-comparison.live.test.ts
Remove-Item Env:RUN_LIVE_RESEARCH_COMPARE
```

Each query has a $0.10 estimated spend cap and 60-second timeout. The comparison is skipped by
default and was not executed here: Claude credentials are unavailable. No live research provider
was connected. This honest separation matters when interpreting nested usage.

On this Windows host the npm shim rejected delegated execution (NVM4306). Use the installed Node
executable with its adjacent `node_modules/npm/bin/npm-cli.js`, and prepend that installation to
PATH. Prisma cache timestamping initially failed EPERM; setting `PRISMA_SCHEMA_ENGINE_BINARY` to
the existing readable cached engine allowed generation without changing permissions or dependencies.

## Exercise

Point live mode at a reviewed test server that rejects its dedicated token, then at a server that
never answers. Confirm the final response explains unavailable external research while still using
stored evidence. Try a foreign security ID: the child must not be contacted. Compare the zero-token
demo with observed native usage before drawing any cost/performance conclusion.
