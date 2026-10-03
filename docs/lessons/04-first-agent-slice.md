# Lesson 04 — The first Claude Agent SDK slice

The first useful AI interaction is deliberately small: one browser question, one validated API request, and one completed answer. The browser imports only shared contracts. The API selects an `AgentService` implementation from server configuration; the agent package owns all SDK code.

## Why two adapters?

`MockAgentService` returns the same clearly labeled response every time, so learners can demonstrate the whole browser-to-API path without a paid account. `ClaudeAgentService` calls `query({ prompt, options })` from `@anthropic-ai/claude-agent-sdk` 0.3.276. Its result message supplies the final user-visible text. SDK messages stay on the server. There is no fallback from Claude mode to mock mode: a missing API key is a configuration error.

The implementation was checked against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`: `query` accepts a prompt and `Options`; `tools: []` disables built-in tools, while `allowedTools` alone is only an auto-approval list. `Options` also declares `model`, `maxTurns`, `maxBudgetUsd`, `abortController`, `cwd`, `env`, `settingSources`, and `persistSession`. The [official Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) distinguishes the local Agent SDK from the Messages client and Managed Agents and instructs third-party applications to use API-key authentication rather than personal Claude login.

## Boundaries to point out in the demo

- Questions are trimmed and limited to 500 characters; the request body is capped at 2,048 characters.
- Claude calls use one turn, an SDK USD 0.02 estimated budget, and a 20-second application timeout. The result is an estimate; this is a teaching budget, not billing enforcement.
- The app requires an explicit model ID and API key. It strips inherited personal OAuth token variables and points `CLAUDE_CONFIG_DIR` and `cwd` at the configured workspace outside the source tree. Session persistence is off. That working directory is not an OS sandbox; tool removal is the capability boundary for this slice.
- The temporary endpoint exists only in local development. The API dev server binds to loopback. It must be removed when authenticated run endpoints arrive.
- No portfolio data or current news reaches the model. The UI says so, and neither adapter claims current prices or research citations.

## Demonstrate and verify

Run `npm ci`, `npm run build`, and `npm run dev`; open `http://127.0.0.1:5173/assistant`, ask a question, and show the labeled mock answer. Run `npm run test` and `npm run test:browser --workspace=@portfolio-pilot/web` with the dev servers running. To test Claude with an application API key, set `AGENT_MODE=claude`, `AGENT_MODEL_ID`, `AGENT_WORKSPACE_DIR` (absolute and outside the repo), and `ANTHROPIC_API_KEY` for the API server, restart dev, and ask a short question once. This milestone had no key or model configured, so the live call remains unverified.
