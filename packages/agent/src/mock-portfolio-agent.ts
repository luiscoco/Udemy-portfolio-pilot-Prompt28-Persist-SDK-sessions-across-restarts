import { proposedChangeSchema } from '@portfolio-pilot/contracts';
import { createApprovalTools } from './approval-tools.js';
import { randomUUID } from 'node:crypto';
import { NEWS_ANALYSIS_SCHEMA_VERSION, type NewsAnalysis, type NewsEventCategory } from '@portfolio-pilot/contracts';
import type { AgentAnswer, AgentService, ToolCallTrace } from './index.js';
import { AgentCancelledError, AgentRunFailure } from './errors.js';
import { SessionResumeError } from './sessions.js';
import type { AgentEventSink, AgentRunResult, AgentSessionLocator, AgentStreamInput, StreamingAgentService } from './streaming.js';
import type { PortfolioToolContext } from './tools/context.js';
import { createPortfolioTools } from './tools/portfolio-tools.js';
import type { PortfolioToolName } from './tools/schemas.js';
import { retrieveLargestHolding } from './research-context.js';
import { createExternalResearchTool, type ResearchMcpConfig } from './research-mcp.js';
import type { HookInput, Options } from '@anthropic-ai/claude-agent-sdk';
import { applicationPolicyHooks, type AuditSink } from './policy-hooks.js';
import { PORTFOLIO_ALLOWED_TOOLS } from './tools/options.js';
import { selectApplicationSkill, skillInstructions, BRIEFING_HEADINGS, EARNINGS_HEADINGS, type ApplicationSkill } from './application-skills.js';

// Read-only view of our own tool JSON (shapes are fixed by portfolio-tools.ts).
type Structured = Record<string, any>;
const MAX_ANSWER_CHARS = 4000;
/** What a mock "session" remembers between turns: only article IDs it cited, never tool payloads. */
export type MockSessionMemory = { turns: number; articleIds: string[] };
/**
 * Process-local, bounded mock session store. Like SDK session files (local to one host), these
 * sessions do not survive a restart and are not visible to another process; the application must
 * detect that and reseed, exactly as it does for live sessions.
 */
export class MockSessionStore {
  private readonly sessions = new Map<string, MockSessionMemory>();
  constructor(private readonly limit = 500) {}
  has(id: string) { return this.sessions.has(id); }
  get(id: string) { return this.sessions.get(id); }
  set(id: string, memory: MockSessionMemory) {
    this.sessions.delete(id); this.sessions.set(id, memory);
    if (this.sessions.size > this.limit) this.sessions.delete(this.sessions.keys().next().value!);
  }
  delete(id: string) { this.sessions.delete(id); }
  clear() { this.sessions.clear(); }
}
export const MOCK_SESSIONS = new MockSessionStore();
/** Differs per process, so a binding written before a restart is recognised as not local. */
const MOCK_PROCESS_KEY = `mock:${randomUUID()}`;
export const MOCK_MODEL_KEY = 'mock:deterministic-planner-v2';

export interface MockAgentOptions {
  auditSink?: AuditSink;
  specialists?: boolean;
  researchMcp?: ResearchMcpConfig;
  /** Delay between streamed chunks so progress and cancellation are observable. */ streamDelayMs?: number; chunkChars?: number;
  sessionStore?: MockSessionStore; hostKey?: string;
}
type RunScope = { resultBytes?: number; maxTurns?: number; trace: ToolCallTrace[]; messageId: string; emit?: AgentEventSink; signal?: AbortSignal; cited: string[]; nextToolCall?: number; hooks?: NonNullable<Options['hooks']> };
type RequestData = { request: string; portfolioId: string | null; asOf: string | null; knownArticleIds: string[]; memorySource: 'session' | 'summary' | null };
/** "that article", "the first cited article", "tell me more" ... (a reference to an earlier turn). */
const FOLLOW_UP = /\b(?:that|this|those|these|the (?:first|second|third|last))\s+(?:cited\s+)?(?:article|story|stories|news|source|one)s?\b|\btell me more\b|\bmore about (?:it|that|this)\b/;
const ORDINAL: Record<string, number> = { first: 0, second: 1, third: 2 };
const CATEGORY_RULES: Array<[RegExp, NewsEventCategory]> = [[/earnings|revenue|profit|quarter/i, 'earnings'], [/guidance|outlook|forecast/i, 'guidance'], [/acqui|merger|takeover/i, 'merger_acquisition'],
  [/regulat|lawsuit|court|probe|fine/i, 'regulatory_legal'], [/product|launch|review|release/i, 'product'], [/ceo|cfo|executive|board/i, 'management'], [/rating|upgrade|downgrade|analyst/i, 'analyst_rating']];
const category = (text: string): NewsEventCategory => CATEGORY_RULES.find(([rule]) => rule.test(text))?.[1] ?? 'other';
function checkAborted(signal?: AbortSignal) { if (signal?.aborted) throw new AgentCancelledError(); }
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new AgentCancelledError()); return; }
    const done = () => { signal?.removeEventListener('abort', stop); resolve(); };
    const timer = setTimeout(done, ms);
    const stop = () => { clearTimeout(timer); reject(new AgentCancelledError()); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}
/** Word-boundary chunks so the draft grows the way a live answer does. */
export function textChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    const space = text.lastIndexOf(' ', end - 1);
    if (end < text.length && space > start) end = space + 1;
    chunks.push(text.slice(start, end)); start = end;
  }
  return chunks;
}
const usd = (value: string | null | undefined, missing = 'unavailable') => value === null || value === undefined ? missing : `${value} USD`;

/**
 * Credential-free demo adapter. It plans deterministically from keywords and invokes the SAME tool
 * handlers the live SDK server registers (same validation, ownership, bounds and metadata), then
 * templates an answer that only repeats tool values. It never calculates figures itself.
 */
export class MockPortfolioAgentService implements AgentService, StreamingAgentService {
  private readonly handlers: Map<string, (args: unknown) => Promise<{ structuredContent?: Structured; isError?: boolean }>>;
  private readonly store: MockSessionStore;
  constructor(private readonly context: PortfolioToolContext, private readonly options: MockAgentOptions = {}) {
    this.store = options.sessionStore ?? MOCK_SESSIONS;
    this.handlers = new Map(createPortfolioTools(context).map(definition => [definition.name, (args: unknown) => definition.handler(args as never, undefined) as Promise<{ structuredContent?: Structured; isError?: boolean }>]));
  }

  private async call(scope: RunScope, tool: PortfolioToolName, args: Record<string, unknown>): Promise<Structured> {
    checkAborted(scope.signal);
    const { trace } = scope;
    // Each tool read and the final answer consume one simulated turn; these are not model tokens.
    if (scope.maxTurns !== undefined && (scope.nextToolCall ?? 0) + 2 > scope.maxTurns) throw new AgentRunFailure('error_max_turns');
    const toolCallId = `${scope.messageId}.t${scope.nextToolCall ?? 0}`;
    scope.nextToolCall = (scope.nextToolCall ?? 0) + 1;
    scope.emit?.({ type: 'tool.status', toolCallId, tool, status: 'started' });
    await this.mockHook(scope, 'PreToolUse', `mcp__portfolio__${tool}`, args);
    const result = await this.handlers.get(tool)!(args);
    await this.mockHook(scope, 'PostToolUse', `mcp__portfolio__${tool}`, args, result);
    const structured = result.structuredContent ?? {};
    scope.emit?.({ type: 'tool.status', toolCallId, tool, status: result.isError ? 'failed' : 'succeeded' });
    trace.push({ tool, arguments: args, outcome: result.isError ? 'error' : 'ok', ...(result.isError ? { errorCode: String(structured.error?.code ?? 'UNKNOWN') } : {}) });
    return structured;
  }

  async ask(question: string): Promise<AgentAnswer> {
    return this.answer(question, { trace: [], messageId: 'mock', cited: [] });
  }

  async sessions(): Promise<AgentSessionLocator> {
    return { hostKey: this.options.hostKey ?? MOCK_PROCESS_KEY, modelKey: MOCK_MODEL_KEY + (this.context.approval ? ':approvals-v1' : '') + (this.options.specialists ? `:specialists=v1:mcp=${this.options.researchMcp?.mode ?? 'off'}` : ''), isAvailable: async id => this.store.has(id) };
  }

  /**
   * Same deterministic plan as `ask`, with live tool progress, chunked text and one authoritative
   * block. Sessions follow the SDK contract: `resumeSessionId` must exist in this process's store
   * (otherwise SessionResumeError before any output); the session remembers only cited article IDs.
   */
  async stream(input: AgentStreamInput): Promise<AgentRunResult> {
    if (Buffer.byteLength(input.prompt, 'utf8') > (input.limits?.promptBytes ?? 48000)) throw new AgentRunFailure('prompt_limit');
    const { streamDelayMs = 0, chunkChars = 24 } = this.options;
    const resume = input.resumeSessionId ?? null;
    if (resume !== null && !this.store.has(resume)) throw new SessionResumeError();
    const memory = resume ? this.store.get(resume) : undefined;
    const sessionId = resume ?? randomUUID();
    const scope: RunScope = { ...(input.limits ? { maxTurns: input.limits.turns, resultBytes: input.limits.toolResultBytes } : {}), trace: [], messageId: input.messageId, emit: input.onEvent, cited: [], ...(input.signal ? { signal: input.signal } : {}) };
    if (input.audit) scope.hooks = applicationPolicyHooks({ allowedTools: [...PORTFOLIO_ALLOWED_TOOLS, 'Skill', ...(this.options.specialists ? ['Agent'] : []), ...(this.options.researchMcp ? ['mcp__portfolio__researchExternal'] : [])] }, input.audit, this.options.auditSink, this.context.now);
    const remember = () => this.store.set(sessionId, { turns: (memory?.turns ?? 0) + 1, articleIds: scope.cited.length ? [...new Set(scope.cited)] : memory?.articleIds ?? [] });
    if (input.outputSchema) {
      const structuredOutput = await this.analyze(this.requestData(input.prompt, memory), scope);
      checkAborted(input.signal);
      remember();
      return { mode: 'mock', text: '', sessionId, structuredOutput };
    }
    const request = this.requestData(input.prompt, memory).request;
    const watch = /add\s+([A-Z][A-Z0-9.\-]*)\s+(?:on\s+([A-Z0-9]{4})\s+)?to (?:my |the )?watchlist/i.exec(request);
    const jsonChange = /propose change:\s*(\{[\s\S]*\})/i.exec(request);
    if (this.context.approval && (watch || jsonChange)) {
      if (scope.maxTurns !== undefined && scope.maxTurns < 2) throw new AgentRunFailure('error_max_turns');
      const change = proposedChangeSchema.parse(jsonChange ? JSON.parse(jsonChange[1]!) : { actionType: 'watchlist.add', arguments: { symbol: watch![1]!.toUpperCase(), exchangeMic: watch![2]?.toUpperCase() ?? 'XNAS' } });
      const permitted = await this.context.approval.authorize(change, input.signal ?? new AbortController().signal);
      if (!permitted) throw new AgentRunFailure('approval_rejected');
      const result = await createApprovalTools(this.context).find(t => t.name === 'proposeChange')!.handler(change, undefined);
      if (scope.resultBytes && Buffer.byteLength(JSON.stringify(result), 'utf8') > scope.resultBytes) throw new AgentRunFailure('tool_result_limit');
      if (result.isError) throw new AgentRunFailure('approval_invalidated');
      const text = '[Mock answer] Your exact approved change was saved. No trades were made.';
      input.onEvent({ type: 'block.completed', blockId: `${input.messageId}.b0`, text });
      remember(); return { mode: 'mock', text, sessionId };
    }
    const reports = this.options.specialists && /research|news|risk|article/i.test(this.requestData(input.prompt, memory).request)
      ? await this.specialistEvidence(input, scope) : '';
    const main = await this.answer(input.prompt, scope, memory);
    const answer = main.answer + reports;
    const blockId = `${input.messageId}.b0`;
    for (const text of textChunks(answer, chunkChars)) {
      checkAborted(input.signal);
      input.onEvent({ type: 'text.delta', blockId, text });
      if (streamDelayMs) await pause(streamDelayMs, input.signal);
    }
    checkAborted(input.signal);
    input.onEvent({ type: 'block.completed', blockId, text: answer });
    remember();
    return { mode: 'mock', text: answer, sessionId };
  }

  /** Credential-free replay of the same policy callbacks; this is not live SDK skill execution. */
  private async mockHook(scope: RunScope, phase: 'PreToolUse' | 'PostToolUse', tool: string, args: unknown, response?: unknown) {
    if (phase === 'PostToolUse' && scope.resultBytes && Buffer.byteLength(JSON.stringify(response) ?? '', 'utf8') > scope.resultBytes) throw new AgentRunFailure('tool_result_limit');
    const input: HookInput = phase === 'PreToolUse'
      ? { hook_event_name: phase, session_id: 'mock', transcript_path: '', cwd: 'mock', tool_name: tool, tool_input: args, tool_use_id: scope.messageId }
      : { hook_event_name: phase, session_id: 'mock', transcript_path: '', cwd: 'mock', tool_name: tool, tool_input: args, tool_use_id: scope.messageId, tool_response: response };
    for (const matcher of scope.hooks?.[phase] ?? []) for (const hook of matcher.hooks) {
      const output = await hook(input, scope.messageId, { signal: scope.signal ?? new AbortController().signal });
      if ('hookSpecificOutput' in output && output.hookSpecificOutput?.hookEventName === 'PreToolUse' && output.hookSpecificOutput.permissionDecision === 'deny') throw new AgentRunFailure('sdk_error');
    }
  }

  private async skillAnswer(skill: ApplicationSkill, data: RequestData, scope: RunScope): Promise<AgentAnswer> {
    await this.mockHook(scope, 'PreToolUse', 'Skill', { skill });
    const instructions = await skillInstructions(skill);
    const headings = skill === 'daily-portfolio-briefing' ? BRIEFING_HEADINGS : EARNINGS_HEADINGS;
    // Assert the mock follows the actual managed artifact's structure rather than a disconnected fixture.
    if (!headings.every(heading => instructions.includes(`## ${heading}`))) throw new AgentRunFailure('sdk_error');
    await this.mockHook(scope, 'PostToolUse', 'Skill', { skill }, { loaded: true });
    const overview = await this.call(scope, 'getPortfolioSummary', data.portfolioId ? { portfolioId: data.portfolioId } : {});
    const portfolios = overview.error ? [] : overview.portfolio ? [overview.portfolio] : (overview.portfolios ?? []).filter((p: Structured) => !p.archived).slice(0, 3);
    const snapshot: string[] = [];
    for (const portfolio of portfolios) {
      snapshot.push(`${portfolio.name}: market value ${usd(portfolio.totals.marketValue)}; remaining cost basis ${usd(portfolio.totals.remainingCostBasis)}. Quote coverage ${portfolio.valuationComplete ? 'complete' : 'incomplete'}.`);
      const holdings = await this.call(scope, 'listHoldings', { portfolioId: portfolio.id, limit: 25 });
      for (const holding of holdings.holdings ?? []) snapshot.push(`${holding.symbol}: quantity ${holding.remainingQuantity}, market value ${usd(holding.marketValue)}, weight ${holding.allocationWeight ?? 'unavailable'}, quote ${holding.quoteStatus}.`);
      if (holdings.meta?.page?.nextOffset !== null) snapshot.push('Holdings sample is bounded to 25; additional holdings may be omitted.');
    }
    const asOf = (this.context.now ?? (() => new Date()))().toISOString();
    const search = await this.call(scope, 'searchNews', { limit: 10, ...(data.portfolioId ? { portfolioId: data.portfolioId } : {}) });
    const articles = (search.articles ?? []).filter((a: Structured) => Date.parse(a.publishedAt) <= Date.parse(asOf) && Date.parse(a.publishedAt) >= Date.parse(asOf) - 86400000
      && (skill === 'daily-portfolio-briefing' || /earnings|revenue|profit|guidance|quarter/i.test(a.title))).slice(0, 3);
    const news: string[] = [];
    for (const article of articles) {
      const detail = await this.call(scope, 'getNewsArticle', { articleId: article.id });
      if (detail.error) continue;
      scope.cited.push(article.id);
      news.push(`[${article.id}](${detail.article.url}) ${detail.article.title}; ${detail.article.source}; published ${detail.article.publishedAt}; ingested ${detail.article.ingestedAt}; ${detail.article.isDelayed ? 'delayed' : 'no reported delay'}; ${detail.article.isSynthetic ? 'synthetic' : 'provider'} evidence.`);
    }
    const coverage = `${asOf} UTC. Scope: ${data.portfolioId ?? 'active portfolios (first three)'}. ${this.context.dataMode} data; mock skill simulation. Stored news covers the last 24 hours (first three matches from ten fetched); polling is near-real-time. ${search.error ? 'News retrieval unavailable.' : ''}`;
    const uncertainty = 'Future outcomes are uncertain. Quotes may be stale or missing; valuation and stored news can be incomplete. No numerical earnings surprise or consensus is inferred.';
    const followup = 'Read cited primary sources and review concentration. Research suggestions only; trades and watchlist/alert changes are not executed.';
    const newsText = news.join('\n') || 'No relevant stored news is available in this bounded window.';
    const sections = skill === 'daily-portfolio-briefing' ? [coverage, snapshot.join('\n') || 'Portfolio unavailable or no active holdings.', newsText, uncertainty, followup]
      : [coverage + '\n' + newsText, snapshot.join('\n') || 'Portfolio unavailable.', 'Interpretation: reports may affect expectations, but the direction is uncertain; reported results alone do not establish future performance.', uncertainty + '\n' + followup];
    return { mode: 'mock', answer: `[Mock answer] Skill used: ${skill}\n\n` + headings.map((heading, i) => `## ${heading}\n${sections[i]}`).join('\n\n'), toolCalls: scope.trace };
  }

  /** Deterministic specialist simulation, not a claim of live SDK/model usage. Main adapter composes the answer. */
  private async specialistEvidence(input: AgentStreamInput, scope: RunScope): Promise<string> {
    const request = this.requestData(input.prompt);
    const portfolioId = request.portfolioId;
    // The main planner resolves scope before assigning the news-only specialist its task.
    const wantsLargest = /largest|biggest/i.test(request.request);
    const largest = wantsLargest ? (await retrieveLargestHolding(this.context, portfolioId)).largest : null;
    const run = async (id: string, work: () => Promise<string>) => {
      const toolCallId = `${input.messageId}.${id}`;
      await this.mockHook(scope, 'PreToolUse', 'Agent', { subagent_type: id === 'news' ? 'news-research' : 'portfolio-risk' });
      input.onEvent({ type: 'tool.status', toolCallId, tool: 'delegation', status: 'started' });
      try {
        const report = await work(); checkAborted(input.signal);
        await this.mockHook(scope, 'PostToolUse', 'Agent', {}, { completed: true });
        input.onEvent({ type: 'tool.status', toolCallId, tool: 'delegation', status: 'succeeded' }); return report;
      } catch (error) { input.onEvent({ type: 'tool.status', toolCallId, tool: 'delegation', status: 'failed' }); throw error; }
    };
    const reports = await Promise.all([
      run('news', async () => {
        if (wantsLargest && (!largest || largest.tied)) return 'News specialist: largest-holding scope is unavailable or ambiguous; no unrelated news was added.';
        const search = await this.call(scope, 'searchNews', { limit: largest ? 10 : 1, ...(portfolioId ? { portfolioId } : {}), ...(largest ? { symbols: [largest.symbol] } : {}) });
        const asOf = (this.context.now ?? (() => new Date()))().getTime();
        const recent = (search.articles ?? []).filter((a: Structured) => Date.parse(a.publishedAt) <= asOf && Date.parse(a.publishedAt) >= asOf - 7 * 86400000);
        const articleId = largest ? recent.find((a: Structured) => a.securities.some((s: Structured) => s.id === largest.securityId))?.id : recent[0]?.id;
        if (!articleId) return 'News specialist: no authorized stored evidence available.';
        const detail = await this.call(scope, 'getNewsArticle', { articleId });
        if (detail.error) return 'News specialist: article unavailable.';
        scope.cited.push(articleId);
        let report = `News specialist evidence: [${articleId}](${detail.article.url}), ${detail.article.source}, published ${detail.article.publishedAt}; ${detail.article.isSynthetic ? 'synthetic' : 'provider'} data.`;
        const securityId = detail.article.securities?.[0]?.id;
        if (securityId && this.options.researchMcp) {
          const toolCallId = `${input.messageId}.external`;
          await this.mockHook(scope, 'PreToolUse', 'mcp__portfolio__researchExternal', { securityId });
          input.onEvent({ type: 'tool.status', toolCallId, tool: 'researchExternal', status: 'started' });
          const external = await createExternalResearchTool({ ...this.context, ...(input.signal ? { signal: input.signal } : {}) }, this.options.researchMcp).handler({ securityId }, undefined);
          await this.mockHook(scope, 'PostToolUse', 'mcp__portfolio__researchExternal', { securityId }, external);
          input.onEvent({ type: 'tool.status', toolCallId, tool: 'researchExternal', status: external.isError ? 'failed' : 'succeeded' });
          report += external.isError ? ' External research unavailable; stored evidence remains usable.' : ' Optional public research context was retrieved (untrusted, supplementary; fixture mode is synthetic).';
        }
        return report;
      }),
      run('risk', async () => {
        const overview = await this.call(scope, 'getPortfolioSummary', portfolioId ? { portfolioId } : {});
        const id = portfolioId ?? overview.portfolios?.find((p: Structured) => !p.archived)?.id;
        if (!id || overview.error) return 'Risk specialist: portfolio unavailable.';
        const holdings = await this.call(scope, 'listHoldings', { portfolioId: id, limit: 1 });
        const holding = holdings.holdings?.[0];
        return holding ? `Risk specialist evidence: ${holding.symbol}, allocation weight ${holding.allocationWeight ?? 'unavailable'}, quote status ${holding.quoteStatus}, as of ${holdings.portfolio.asOf}. This is a bounded sample, not a full portfolio risk assessment.` : 'Risk specialist: holdings unavailable.';
      })
    ]);
    return `\n\n[Mock specialist simulation; no model tokens consumed]\n${reports.join('\n')}`;
  }

  /** Reads the request JSON. Earlier articles come from the resumed session, else from the authorized seed summary. */
  private requestData(prompt: string, memory?: MockSessionMemory): RequestData {
    let data: Structured = {};
    try { const parsed = JSON.parse(prompt); if (parsed?.kind === 'untrusted_research_request_data') data = parsed; } catch { /* Plain questions remain supported for tool tests. */ }
    const seeded = ((data.seed?.citedSources ?? []) as Structured[]).map(s => String(s.articleId));
    const knownArticleIds = memory?.articleIds.length ? memory.articleIds : seeded;
    return { request: typeof data.request === 'string' ? data.request : prompt, portfolioId: data.portfolioId ?? null, asOf: typeof data.asOf === 'string' ? data.asOf : null, knownArticleIds,
      memorySource: memory?.articleIds.length ? 'session' : seeded.length ? 'summary' : null };
  }

  /** Deterministic news-analysis-v1 document built only from this run's authorized tool results. */
  private async analyze(data: RequestData, scope: RunScope): Promise<NewsAnalysis> {
    const asOf = data.asOf ?? (this.context.now ?? (() => new Date()))().toISOString();
    let ids = FOLLOW_UP.test(data.request.toLowerCase()) ? data.knownArticleIds.slice(0, 3) : [];
    if (!ids.length) {
      const search = await this.call(scope, 'searchNews', { limit: 10, ...(data.portfolioId ? { portfolioId: data.portfolioId } : {}) });
      const since = Date.parse(asOf) - 7 * 86400000;
      ids = search.error ? [] : (search.articles as Structured[]).filter(a => Date.parse(a.publishedAt) >= since && Date.parse(a.publishedAt) <= Date.parse(asOf)).slice(0, 3).map(a => String(a.id));
    }
    const details: Structured[] = [];
    for (const articleId of ids) {
      const detail = await this.call(scope, 'getNewsArticle', { articleId });
      if (!detail.error) { details.push(detail); scope.cited.push(articleId); }
    }
    // Like the live instruction: no readable article means no structured output, never an invented one.
    if (!details.length) throw new AgentRunFailure('analysis_no_output');
    const all = details.map(d => String(d.article.id));
    const securities = new Map<string, NewsAnalysis['affectedSecurities'][number]>();
    for (const d of details) {
      const held = new Set((d.relatedHoldings as Structured[]).flatMap(i => (i.positions as Structured[]).map(p => String(p.securityId))));
      const watched = new Set(d.watchlistedSecurityIds as string[]);
      for (const s of d.article.securities as Structured[]) {
        const entry: NewsAnalysis['affectedSecurities'][number] = securities.get(s.id) ?? { securityId: s.id, symbol: s.symbol, relation: held.has(s.id) ? 'held' as const : watched.has(s.id) ? 'watchlisted' as const : 'mentioned' as const, articleIds: [] };
        entry.articleIds.push(String(d.article.id)); securities.set(s.id, entry);
      }
    }
    const synthetic = details.some(d => d.article.isSynthetic), delayed = details.some(d => d.article.isDelayed);
    return {
      schemaVersion: NEWS_ANALYSIS_SCHEMA_VERSION, asOf,
      articles: details.map(d => ({ articleId: d.article.id, title: d.article.title, publishedAt: d.article.publishedAt })),
      events: details.map(d => ({ category: category(d.article.title), description: `Reported by ${d.article.source}: ${d.article.title}`.slice(0, 600), articleIds: [d.article.id] })),
      affectedSecurities: [...securities.values()].slice(0, 20),
      factualSummary: details.map(d => ({ statement: `${d.article.source} published "${d.article.title}" at ${d.article.publishedAt}.`.slice(0, 600), articleIds: [d.article.id] })),
      interpretations: [{ statement: `[Mock] These reports concern ${[...securities.values()].map(s => s.symbol).join(', ') || 'the cited securities'}; any effect on future returns is uncertain.`.slice(0, 600), confidence: 'low', articleIds: all }],
      uncertainties: [{ statement: `Stored news may be incomplete and polling is near-real-time.${synthetic ? ' Some evidence is synthetic demo data.' : ''}${delayed ? ' Some evidence is delayed.' : ''}`, articleIds: synthetic || delayed ? all : [] }],
      evidence: details.map(d => ({ articleId: d.article.id, url: d.article.url }))
    };
  }

  /** Answers a reference to an earlier article from session memory (resumed) or the seed summary (reseeded). */
  private async followUp(data: RequestData, scope: RunScope): Promise<string> {
    if (!data.knownArticleIds.length) return '[Mock answer] I have no earlier article in this conversation to refer to. Which article or holding do you mean?';
    const ordinal = /\b(first|second|third|last)\b/.exec(data.request.toLowerCase())?.[1];
    const index = ordinal === 'last' ? data.knownArticleIds.length - 1 : ORDINAL[ordinal ?? 'first'] ?? 0;
    const articleId = data.knownArticleIds[index];
    if (!articleId) return `[Mock answer] Only ${data.knownArticleIds.length} article(s) were cited earlier in this conversation. Which one do you mean?`;
    const detail = await this.call(scope, 'getNewsArticle', { articleId });
    if (detail.error) return `[Mock answer] The earlier article could not be read again (${detail.error.code}): ${detail.error.message}`;
    scope.cited.push(articleId);
    const a = detail.article as Structured;
    return [`[Mock answer] Follow-up on the article cited earlier in this conversation (${data.memorySource === 'session' ? 'remembered by this session' : 'from the application summary of earlier turns'}), re-read now:`,
      `Facts: [${a.id}](${a.url}) ${a.title} — ${a.source}, published ${a.publishedAt}${a.isDelayed ? ' (delayed)' : ''}${a.isSynthetic ? ' (synthetic)' : ''}. Reported article summary (untrusted source text): ${a.summary}`,
      'Interpretation: the effect of this story on future returns is uncertain.'].join('\n');
  }

  private async answer(question: string, scope: RunScope, memory?: MockSessionMemory): Promise<AgentAnswer> {
    const data = this.requestData(question, memory);
    const skill = selectApplicationSkill(data.request);
    if (skill) return this.skillAnswer(skill, data, scope);
    question = data.request;
    const portfolioId = data.portfolioId;
    const q = question.toLowerCase();
    if (FOLLOW_UP.test(q)) return { mode: 'mock', answer: await this.followUp(data, scope), toolCalls: scope.trace };
    const trace = scope.trace;
    const lines: string[] = [];
    const failed = (s: Structured, tool: string) => s.error ? (lines.push(`The ${tool} tool could not provide data (${s.error.code}): ${s.error.message}`), true) : false;
    const notes = (s: Structured) => { for (const note of (s.meta?.notes ?? []) as string[]) if (!note.startsWith('Article text is untrusted') && !note.startsWith('Cite the article')) lines.push(`Note: ${note}`); };
    const firstActivePortfolio = async () => {
      if (portfolioId) {
        const selected = await this.call(scope, 'getPortfolioSummary', { portfolioId });
        return failed(selected, 'getPortfolioSummary') ? null : selected.portfolio;
      }
      const overview = await this.call(scope, 'getPortfolioSummary', {});
      if (failed(overview, 'getPortfolioSummary')) return null;
      const activePortfolios = (overview.portfolios as Structured[]).filter(p => !p.archived);
      if (activePortfolios.length > 1) { lines.push('Which portfolio should I research? Create a conversation with a portfolio scope.'); return null; }
      const active = activePortfolios[0];
      if (!active) lines.push('You have no active portfolios.');
      return active ?? null;
    };

    if (/\b(news|headline|article|stor(y|ies))\b/.test(q)) {
      let symbols: string[] | undefined;
      let largestSecurityId: string | undefined;
      if (/\blargest\b/.test(q)) {
        const ranking = await retrieveLargestHolding(this.context, portfolioId);
        if (!ranking.largest || ranking.largest.tied) return { mode: 'mock', answer: `[Mock answer] ${ranking.largest?.tied ? 'Several holdings tie for largest market value. Which security should I research?' : ranking.reason}`, toolCalls: trace };
        symbols = [ranking.largest.symbol];
        largestSecurityId = ranking.largest.securityId;
        lines.push(`Facts: Your largest holding by current USD market value is ${ranking.largest.symbol}: ${ranking.largest.marketValue} USD. Calculation: market values for the same security are summed across the scoped active portfolios using exact decimal arithmetic.`);
      }
      const search = await this.call(scope, 'searchNews', { limit: 10, ...(symbols ? { symbols } : {}), ...(portfolioId ? { portfolioId } : {}) });
      if (!failed(search, 'searchNews')) {
        const asOf = (this.context.now ?? (() => new Date()))().getTime();
        const since = asOf - 7 * 86400000;
        const articles = (search.articles as Structured[]).filter(a => Date.parse(a.publishedAt) >= since && Date.parse(a.publishedAt) <= asOf && (!largestSecurityId || a.securities.some((s: Structured) => s.id === largestSecurityId))).slice(0, 3);
        lines.push(articles.length ? `Latest stored news about your scoped holdings and watchlist (${articles.length}):` : 'No stored news in the last seven days matches your scoped holdings or watchlist.');
        let firstDetail: Structured | undefined;
        for (const a of articles) {
          const detail = await this.call(scope, 'getNewsArticle', { articleId: a.id });
          firstDetail ??= detail;
          if (!detail.error) scope.cited.push(String(a.id));
          if (!failed(detail, 'getNewsArticle')) lines.push(`- [${a.id}](${a.url}) ${a.title} — ${a.source}, published ${a.publishedAt}${a.isDelayed ? ' (delayed)' : ''}${a.isSynthetic ? ' (synthetic)' : ''}. Reported article summary (untrusted source text): ${detail.article.summary}`);
        }
        lines.push('Interpretation: These stories concern the related security; their effect on future returns is uncertain. This is stored reporting from the last seven days, not a complete news feed.');
        if (search.meta.page.nextCursor) lines.push('Evidence is incomplete: additional articles may exist beyond this fetched page. Narrow the request to retrieve more.');
        if (articles[0]) {
          const detail = firstDetail!;
          if (!failed(detail, 'getNewsArticle')) {
            for (const impact of detail.relatedHoldings as Structured[]) for (const p of impact.positions as Structured[]) lines.push(`  Related holding in "${impact.name}": ${p.symbol} quantity ${p.remainingQuantity}, market value ${usd(p.marketValue)} (quote ${p.quoteStatus}).`);
            if (!(detail.relatedHoldings as Structured[]).length) lines.push('  None of your open positions hold the related securities.');
          }
        }
        notes(search);
      }
    } else if (/\b(quote|quotes|price|prices|trading at)\b/.test(q)) {
      let securityIds: string[] | undefined;
      if (portfolioId) {
        const holdings = await this.call(scope, 'listHoldings', { portfolioId, limit: 25 });
        if (failed(holdings, 'listHoldings')) return { mode: 'mock', answer: `[Mock answer] ${lines.join('\n')}`, toolCalls: trace };
        securityIds = holdings.holdings.map((h: Structured) => h.securityId);
        if (!securityIds?.length) return { mode: 'mock', answer: '[Mock answer] This portfolio has no open holdings to quote.', toolCalls: trace };
        if (holdings.meta.page.nextOffset !== null) lines.push('Only the first 25 scoped holdings are quoted; further holdings are not included.');
      }
      const quotes = await this.call(scope, 'getQuotes', securityIds ? { securityIds } : {});
      if (!failed(quotes, 'getQuotes')) {
        for (const x of quotes.quotes as Structured[]) lines.push(`- ${x.symbol} (${x.exchangeMic}): ${x.price === null ? 'no usable quote' : `${usd(x.price)} as of ${x.asOf}`} — ${x.status}${x.provider ? `, ${x.provider}` : ''}${x.isSynthetic ? ', synthetic' : ''}`);
        if (!(quotes.quotes as Structured[]).length) lines.push('You have no held or watchlisted securities to quote.');
        notes(quotes);
      }
    } else if (/\b(transactions?|trades?|bought|sold|history|fees?)\b/.test(q)) {
      const portfolio = await firstActivePortfolio();
      if (portfolio) {
        const page = await this.call(scope, 'listTransactions', { portfolioId: portfolio.id, limit: 5 });
        if (!failed(page, 'listTransactions')) {
          lines.push(`First ${(page.transactions as Structured[]).length} recorded trade(s) in "${portfolio.name}" (oldest first):`);
          for (const t of page.transactions as Structured[]) lines.push(`- ${t.occurredAt} ${t.side} ${t.quantity} ${t.symbol} at ${usd(t.price)}, fees ${usd(t.fees)}, amount ${usd(t.amount)}`);
          if (page.meta.page.nextOffset !== null) lines.push(`More trades are available from offset ${page.meta.page.nextOffset}.`);
        }
      }
    } else if (/\b(holdings?|positions?|own|shares)\b/.test(q)) {
      const portfolio = await firstActivePortfolio();
      if (portfolio) {
        const page = await this.call(scope, 'listHoldings', { portfolioId: portfolio.id });
        if (!failed(page, 'listHoldings')) {
          lines.push(`Open holdings in "${portfolio.name}" as of ${page.portfolio.asOf}:`);
          for (const h of page.holdings as Structured[]) lines.push(`- ${h.symbol} (${h.exchangeMic}): quantity ${h.remainingQuantity}, cost basis ${usd(h.remainingCostBasis)}, market value ${usd(h.marketValue)}, quote ${h.quote ? `${usd(h.quote.price)} at ${h.quote.asOf}` : 'none'} (${h.quoteStatus})`);
          if (!(page.holdings as Structured[]).length) lines.push('- No open positions.');
          notes(page);
        }
      }
    } else {
      const overview = await this.call(scope, 'getPortfolioSummary', portfolioId ? { portfolioId } : {});
      if (!failed(overview, 'getPortfolioSummary')) {
        lines.push(`Your portfolios as of ${overview.meta.generatedAt}:`);
        for (const p of (overview.portfolios ?? [overview.portfolio]) as Structured[]) lines.push(`- ${p.name}${p.archived ? ' (archived)' : ''}: market value ${usd(p.totals.marketValue, 'unavailable (valuation incomplete)')}, remaining cost basis ${usd(p.totals.remainingCostBasis)}, realized gain/loss ${usd(p.totals.realizedGainLoss)}, unrealized gain/loss ${usd(p.totals.unrealizedGainLoss)}.`);
        if (overview.combined) lines.push(`Combined active portfolios: market value ${usd(overview.combined.marketValue, 'unavailable (valuation incomplete)')}, realized gain/loss ${usd(overview.combined.realizedGainLoss)}.`);
        notes(overview);
      }
    }
    const answer = `[Mock answer] ${lines.join('\n')}`;
    return { mode: 'mock', answer: answer.length > MAX_ANSWER_CHARS ? `${answer.slice(0, MAX_ANSWER_CHARS - 1)}…` : answer, toolCalls: trace };
  }
}
