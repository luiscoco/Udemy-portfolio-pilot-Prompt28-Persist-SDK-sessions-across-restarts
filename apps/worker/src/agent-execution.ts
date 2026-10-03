import { AgentCancelledError, AgentConfigurationError, AgentRunFailure, ANALYSIS_POLICY, analysisCorrection, buildResearchPrompt, ClaudePortfolioAgentService, conversationSeed, MockPortfolioAgentService, NEWS_ANALYSIS_OUTPUT_SCHEMA, PORTFOLIO_INSTRUCTION_VERSION, renderNewsAnalysis, researchContext, SessionResumeError, validateNewsAnalysis, type AgentRunResult, type AgentSessionLocator, type PortfolioToolContext, type ResearchPromptInput, type StreamingAgentService } from '@portfolio-pilot/agent';
import { type AgentRun, type AgentUsage, type ChatMessage, type Conversation, type NewsAnalysis, type SessionContinuity } from '@portfolio-pilot/contracts';
import { type ApprovalService, type ChatService, type RunOutcome, type SessionBinding } from '@portfolio-pilot/db';
import { parseServerConfig } from '@portfolio-pilot/config/server';
const stopReason = (signal: AbortSignal) => signal.aborted ? (signal.reason === 'cancelled' ? 'cancelled' : 'timeout') : null;
import { RunEventPublisher } from './agent-run-events.js';
import { usdMicros, usdString } from './agent-budget-money.js';

/** Fixed public texts: never raw SDK/provider errors, configuration or tool arguments. */
export const RUN_MESSAGES = {
  failed: 'The assistant could not complete this answer. Please try again. No trades were made. Previously approved changes remain saved; pending changes cannot execute.',
  analysisFailed: 'The structured analysis could not be validated against the articles that were actually read, so it is not shown. Please try again. No trades were made. Previously approved changes remain saved; pending changes cannot execute.',
  cancelled: 'You cancelled this answer before it finished. No trades were made. Previously approved changes remain saved; pending changes cannot execute.',
  interrupted: 'This answer was interrupted before it finished. Please try again. No trades were made. Previously approved changes remain saved; pending changes cannot execute.'
} as const;
const LIMIT_MESSAGES: Record<string, string> = {
  timeout: 'The assistant reached its time limit. The answer has stopped. You can send a smaller request.',
  prompt_limit: 'This request and its context exceed the prompt size limit. Your portfolio scope was preserved. Start a new conversation or explicitly select a smaller scope.',
  tool_result_limit: 'The requested data exceed the tool result size limit. The answer has stopped. Select a smaller scope or ask for a smaller page of data.',
  scope_limit: 'The full portfolio scope could not fit within the context limit. Select a portfolio explicitly; no partial-scope answer was saved.',
  error_max_turns: 'The assistant reached its turn limit. The answer has stopped. Try a more focused request.',
  error_max_budget_usd: 'The assistant reached its cost or usage limit. The answer has stopped. Try a more focused request.',
  usage_version: 'The assistant runtime usage format changed. This answer has stopped; server configuration needs review.',
  usage_uncertain: 'Usage from the previous attempt is uncertain, so the assistant stopped instead of spending more on a retry. Start a new request if you want to continue.'
};
function limitsConfig() { return parseServerConfig({ DATA_MODE: 'mock', ...process.env }); }
/** Race app dependencies as well as the SDK, so every watchdog produces a terminal outcome. */
async function bounded<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new AgentCancelledError();
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => { abort = () => reject(new AgentCancelledError()); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(work), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

export type AgentFactory = (tools: PortfolioToolContext, binding?: SessionBinding | null) => StreamingAgentService | Promise<StreamingAgentService>;
export interface RunDependencies {
  ownerId: string;
  chat: ChatService;
  approvals?: ApprovalService;
  tools: PortfolioToolContext;

  agentFactory?: AgentFactory;

}

export function defaultAgent(tools: PortfolioToolContext, runtime?: { workspace: string; transcripts: import('@portfolio-pilot/agent').TurnTranscriptStore; mock: import('@portfolio-pilot/agent').MockSessionStore }): StreamingAgentService {
  const config = parseServerConfig(process.env);
  const research = config.RESEARCH_MCP_MODE === 'off' ? {} : { researchMcp: { mode: config.RESEARCH_MCP_MODE,
    ...(config.RESEARCH_MCP_SCRIPT_PATH ? { scriptPath: config.RESEARCH_MCP_SCRIPT_PATH } : {}), ...(config.RESEARCH_MCP_TOKEN ? { token: config.RESEARCH_MCP_TOKEN } : {}) } };
  return config.AGENT_MODE === 'mock'
    ? new MockPortfolioAgentService(tools, { streamDelayMs: config.AGENT_MOCK_STREAM_DELAY_MS, specialists: config.AGENT_SPECIALISTS_ENABLED,
      ...research, ...(runtime ? { sessionStore: runtime.mock } : {}) })
    : new ClaudePortfolioAgentService({ tools, apiKey: config.ANTHROPIC_API_KEY, modelId: config.AGENT_MODEL_ID!, workspaceDir: runtime?.workspace ?? config.AGENT_WORKSPACE_DIR!,
      timeoutMs: config.AGENT_WALL_CLOCK_MS, maxTurns: config.AGENT_MAX_TURNS, maxBudgetUsd: config.AGENT_MAX_COST_USD,
      specialists: config.AGENT_SPECIALISTS_ENABLED,
      ...research, ...(runtime ? { sessionStore: runtime.transcripts } : {}) });
}
const safeCode = (code: string) => /^[a-z_]{1,32}$/.test(code) ? code : 'internal';
function failureCode(error: unknown, signal: AbortSignal): string {
 if (signal.aborted && signal.reason !== 'cancelled') return signal.reason === 'timeout' ? 'timeout' : 'interrupted';
 if (error instanceof AgentRunFailure) return safeCode(error.code);
 if (error instanceof AgentConfigurationError) return 'configuration';
 return 'internal';
}
export async function resolveSession(binding: SessionBinding | null, locator: AgentSessionLocator, hasEarlierTurns: boolean): Promise<{ resume: string | null; continuity: SessionContinuity }> {
  const reseed = (reason: NonNullable<SessionContinuity['reason']>) => ({ resume: null, continuity: { disposition: 'reseeded' as const, reason } });
  if (!binding) return hasEarlierTurns ? reseed('not_recorded') : { resume: null, continuity: { disposition: 'new', reason: null } };
  // A resumed session keeps the system prompt and model it started with; never mix configurations.
  if (binding.modelKey !== locator.modelKey || binding.instructionVersion !== PORTFOLIO_INSTRUCTION_VERSION) return reseed('configuration_changed');
  if (binding.hostKey !== locator.hostKey) return reseed('not_local');
  if (!await locator.isAvailable(binding.sdkSessionId).catch(() => false)) return reseed('session_missing');
  return { resume: binding.sdkSessionId, continuity: { disposition: 'resumed', reason: null } };
}

export async function executeRun(input: RunDependencies & { conversation: Conversation; run: AgentRun; userMessage: ChatMessage; publisher: RunEventPublisher; signal: AbortSignal }) {
  const { chat, run, publisher, conversation } = input;
  const config = limitsConfig();
  const limitController = new AbortController();
  const signal = AbortSignal.any([input.signal, limitController.signal]);
  let limitCode: string | null = null;
  publisher.started(input.userMessage.id);
  let proposedMutation = false;
  const receipts = new Map<string, string>();
  const approvals = input.approvals;
  const permission = approvals ? {
    rules: () => approvals.rules(),
    async authorize(change: unknown, permissionSignal: AbortSignal) {
      const key = JSON.stringify(change);
      const existing = receipts.get(key);
      if (existing) return (await approvals.get(existing)).status === 'approved';
      if (signal.aborted || permissionSignal.aborted) return false;
      proposedMutation = true;
      const row = await approvals.propose(run.id, change);
      for (;;) {
        if (signal.aborted || permissionSignal.aborted) throw new AgentCancelledError();
        const current = (await approvals.list(run.id)).find(a => a.id === row.id)!;
        if (current.status === 'approved') { receipts.set(key, row.id); return true; }
        if (current.status !== 'pending') throw new AgentRunFailure('approval_' + current.status);
        await new Promise<void>(resolve => setTimeout(resolve, 200));
      }
    },
    async execute(change: unknown) {
      if (signal.aborted) throw new AgentCancelledError();
      const id = receipts.get(JSON.stringify(change));
      if (!id) throw new AgentRunFailure('approval_required');
      return approvals.consume(id, run.id, change);
    }
  } : undefined;
  const context = researchContext({ ...input.tools, signal, resultBytes: config.AGENT_MAX_TOOL_RESULT_BYTES,
    onResult: (name, result) => {
      input.tools.onResult?.(name, result);
      if (name === 'getPortfolioSummary' && (result.meta as { truncated?: boolean })?.truncated) { limitCode = 'scope_limit'; limitController.abort(); }
    },
    onLimit: code => { limitCode = code; limitController.abort(); }, ...(permission ? { approval: permission } : {}) });
  let continuity: SessionContinuity | null = null;
  let attempts = 0;
  let invoked = 0;
  const reported = new Map<number, NonNullable<AgentRunResult['usage']>>();
  let actualModel: string | null = null;
  let mock = false;
  // Convert each SDK estimate upward to integer microdollars before adding money.
  const totals = () => [...reported.values()].reduce((sum, u) => ({ costMicros: sum.costMicros + usdMicros(u.costUsd, 'up'), tokens: sum.tokens + u.aggregateTokens, turns: sum.turns + (u.turns ?? 0) }), { costMicros: 0, tokens: 0, turns: 0 });
  let outcome: RunOutcome;
  let agent: StreamingAgentService | undefined;
  let completedSession: { sessionId: string; mode: 'mock' | 'claude'; locator: AgentSessionLocator; generation: number | null } | null = null;
  try {
    // Every saved source reference enters the summary. Never pretend the latest page is all history.
    const history: ChatMessage[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await bounded(signal, () => chat.messages(conversation.id, { limit: 50, ...(before ? { before } : {}) }));
      history.unshift(...page.messages.filter(m => m.id !== input.userMessage.id));
      if (!page.nextBefore) break;
      if (history.length >= 1000) throw new AgentRunFailure('prompt_limit');
      before = page.nextBefore;
    }
    const binding = await bounded(signal, () => chat.sessionBinding(conversation.id));
    // Await factory completion so abort cannot discard a newly created workspace before cleanup owns it.
    agent = await (input.agentFactory ? input.agentFactory(context.tools, binding) : defaultAgent(context.tools));
    if (signal.aborted) throw new AgentCancelledError();
    const activeAgent = agent;
    const locator = await bounded(signal, () => activeAgent.sessions());
    mock = locator.modelKey.startsWith('mock:');
    // Turns are serialized by the durable conversation lease and active-run index, so this read and
    // the compare-and-set below cannot interleave with another turn of the same conversation.
    let generation = binding?.generation ?? null;
    const reset = binding && (binding.generation % config.AGENT_CONTEXT_RESET_TURNS === 0);
    const resolved = reset ? { resume: null, continuity: { disposition: 'reseeded' as const, reason: 'context_limit' as const } }
      : await bounded(signal, () => resolveSession(binding, locator, history.some(m => m.status === 'completed')));
    continuity = resolved.continuity;
    const promptInput = (disposition: SessionContinuity['disposition'], correction?: string[]): ResearchPromptInput => ({
      portfolioId: conversation.portfolioId, content: input.userMessage.content, kind: run.kind, continuity: disposition,
      seed: disposition === 'reseeded' ? conversationSeed(history) : null, ...(correction ? { correction } : {}) });
    const attempt = async (prompt: ResearchPromptInput, resumeSessionId: string | null): Promise<AgentRunResult> => {
      if (attempts > 0 && proposedMutation) throw new AgentRunFailure('unsafe_replay');
      attempts++;
      const text = await bounded(signal, () => buildResearchPrompt(context.tools, prompt));
      if (Buffer.byteLength(text, 'utf8') > config.AGENT_MAX_PROMPT_BYTES) throw new AgentRunFailure('prompt_limit');
      const used = totals();
      if (invoked > 0 && !mock && (reported.size !== invoked || [...reported.values()].some(u => u.complete === false))) throw new AgentRunFailure('usage_uncertain');
      if (used.costMicros >= usdMicros(config.AGENT_MAX_COST_USD, 'down')) throw new AgentRunFailure('error_max_budget_usd');
      if (used.turns >= config.AGENT_MAX_TURNS) throw new AgentRunFailure('error_max_turns');
      if (signal.aborted) throw new AgentCancelledError();
      invoked++;
      const attemptId = attempts;
      const result = await bounded(signal, () => activeAgent.stream({ prompt: text, messageId: run.assistantMessageId, signal, onEvent: event => { if (!signal.aborted) publisher.agent(event); }, resumeSessionId,
        limits: { promptBytes: config.AGENT_MAX_PROMPT_BYTES, toolResultBytes: config.AGENT_MAX_TOOL_RESULT_BYTES,
          turns: config.AGENT_MAX_TURNS - used.turns, costUsd: Number(usdString(usdMicros(config.AGENT_MAX_COST_USD, 'down') - used.costMicros)) },
        onModel: model => { actualModel = model.slice(0, 128); },
        onUsage: usage => { reported.set(attemptId, usage); },
        audit: { actorId: input.ownerId, conversationId: conversation.id, runId: run.id },
        ...(run.kind === 'news_analysis' ? { outputSchema: NEWS_ANALYSIS_OUTPUT_SCHEMA } : {}) }));
      if (signal.aborted) throw new AgentCancelledError();
      if (result.usage) reported.set(attemptId, result.usage); // replaces callback, never adds it again
      if (result.reportedModel) actualModel = result.reportedModel.slice(0, 128);
      mock = result.mode === 'mock';
      if (totals().costMicros > usdMicros(config.AGENT_MAX_COST_USD, 'down')) throw new AgentRunFailure('error_max_budget_usd');
      if (totals().turns > config.AGENT_MAX_TURNS) throw new AgentRunFailure('error_max_turns');
      if (result.sessionId && !activeAgent.checkpoint) {
        const bound = await bounded(signal, () => chat.bindSession(conversation.id, generation, { sdkSessionId: result.sessionId!, agentMode: result.mode, hostKey: locator.hostKey,
          instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, modelKey: locator.modelKey, runId: run.id }));
        if (bound) generation = (generation ?? 0) + 1;
      }
      return result;
    };
    let result: AgentRunResult;
    try { result = await attempt(promptInput(continuity.disposition), resolved.resume); }
    catch (error) {
      // The SDK could not resume and nothing was shown yet: run this turn once in a NEW session seeded
      // from the authorized summary, and report it. Never claim the earlier session continued.
      if (!(error instanceof SessionResumeError) || resolved.resume === null) throw error;
      continuity = { disposition: 'reseeded', reason: 'resume_failed' };
      result = await attempt(promptInput('reseeded'), null);
    }
    if (signal.aborted) throw new AgentCancelledError();
    let analysis: NewsAnalysis | null = null;
    if (run.kind === 'news_analysis') {
      // Untrusted structured output: schema AND references are validated against this run's reads.
      for (;;) {
        const verdict = validateNewsAnalysis(result.structuredOutput, context.evidence(), (input.tools.now ?? (() => new Date()))());
        if (verdict.ok) { analysis = verdict.analysis; break; }
        if (attempts >= ANALYSIS_POLICY.maxAttempts) throw new AgentRunFailure(verdict.code);
        // Bounded retry in the same SDK session when there is one; the correction names paths only.
        const retrySession = result.sessionId;
        try { result = await attempt(promptInput(retrySession ? 'resumed' : continuity.disposition, analysisCorrection(verdict)), retrySession); }
        catch (error) {
          if (!(error instanceof SessionResumeError)) throw error;
          result = await attempt(promptInput(continuity.disposition, analysisCorrection(verdict)), null);
        }
        if (signal.aborted) throw new AgentCancelledError();
      }
    }
    const evidence = context.evidence();
    const content = analysis ? renderNewsAnalysis(analysis, evidence) : result.text;
    if (!content.trim() || content.length > 16000) throw new AgentRunFailure('invalid_answer');
    // An analysis lists exactly its validated articles as sources; an answer lists every article read.
    const sources = analysis ? analysis.articles.map(a => evidence.get(a.articleId)!.source) : context.sources();
    if (activeAgent.checkpoint) {
      if (!result.sessionId) throw new AgentRunFailure('artifact_missing');
      completedSession = { sessionId: result.sessionId, mode: result.mode, locator, generation: binding?.generation ?? null };
    }
    outcome = { status: 'completed', failureCode: null, content, mode: result.mode, instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, sources, analysis, continuity, attempts };
  } catch (error) {
    const code = limitCode ?? failureCode(error, input.signal);
    outcome = stopReason(input.signal) === 'cancelled'
      ? { status: 'cancelled', failureCode: null, content: RUN_MESSAGES.cancelled, mode: null, instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, sources: [], continuity, attempts }
      : { status: 'failed', failureCode: code, content: LIMIT_MESSAGES[code] ?? (code === 'interrupted' ? RUN_MESSAGES.interrupted : code.startsWith('analysis_') ? RUN_MESSAGES.analysisFailed : RUN_MESSAGES.failed), mode: null, instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, sources: [], continuity, attempts };
  }
  const total = totals();
  const valid = Number.isSafeInteger(total.costMicros) && total.costMicros >= 0 && Number.isSafeInteger(total.tokens) && total.tokens >= 0 && Number.isSafeInteger(total.turns) && total.turns >= 0;
  const usage: AgentUsage = { accounting: invoked === 0 ? 'not_started' : mock ? 'mock' : (valid && (invoked === reported.size) && [...reported.values()].every(u => u.complete !== false) ? 'sdk_estimate' : 'conservative'),
    estimatedCostUsd: valid ? usdString(total.costMicros) : '0.000000', aggregateTokens: valid ? total.tokens : 0, turns: valid ? total.turns : 0, resultCount: reported.size };
  outcome = { ...outcome, usage, actualModel };
  try {
    await publisher.drain();
    if (publisher.failures && outcome.status === 'completed') outcome = { ...outcome, status: 'failed', failureCode: 'progress_failure', content: RUN_MESSAGES.interrupted, analysis: null };
    if (outcome.status === 'completed' && completedSession && agent?.checkpoint) {
      try {
        const artifact = await bounded(signal, () => agent!.checkpoint!(completedSession!.sessionId));
        if (signal.aborted) throw new AgentCancelledError();
        outcome.checkpoint = { expectedGeneration: completedSession.generation, binding: {
          sdkSessionId: completedSession.sessionId, agentMode: completedSession.mode, hostKey: completedSession.locator.hostKey,
          modelKey: completedSession.locator.modelKey, instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, artifact } };
      } catch {
        outcome = { ...outcome, status: 'failed', failureCode: 'artifact_save', content: RUN_MESSAGES.interrupted, analysis: null };
      }
    }
    await announceOutcome(chat, run.id, outcome, publisher);
  } finally { await agent?.cleanup?.(); }
}

/** Persists the outcome exactly once; only the finisher that wins announces it. */
async function announceOutcome(chat: ChatService, runId: string, outcome: RunOutcome, publisher: RunEventPublisher) {
  const finished = await chat.finishRun(runId, outcome);
  publisher.abandon();
  return finished;
}
