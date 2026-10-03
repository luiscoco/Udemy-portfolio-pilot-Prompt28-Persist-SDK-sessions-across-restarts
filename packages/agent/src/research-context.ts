import { chatSourceSchema, validatedSourceUrl, type ChatMessage, type ChatRunKind, type ChatSource } from '@portfolio-pilot/contracts';
import type { PortfolioToolContext } from './tools/context.js';
import { createPortfolioTools } from './tools/portfolio-tools.js';
import { largestHolding } from '@portfolio-pilot/domain';
import { AgentRunFailure } from './errors.js';

export async function retrieveLargestHolding(context: PortfolioToolContext, portfolioId: string | null) {
  const definitions = createPortfolioTools(context);
  const call = async (name: string, args: unknown) => {
    const result = await definitions.find(t => t.name === name)!.handler(args as never, undefined);
    if (result.isError) throw new Error('Authorized holding data unavailable.');
    return result.structuredContent as Record<string, any>;
  };
  const overview = await call('getPortfolioSummary', portfolioId ? { portfolioId } : {});
  const portfolios = portfolioId ? [overview.portfolio] : overview.portfolios.filter((p: { archived: boolean }) => !p.archived);
  const positions: { securityId: string; symbol: string; marketValue: string | null }[] = [];
  let pages = 0;
  if (overview.meta.truncated) return { largest: null, reason: 'Portfolio scope is truncated.' };
  for (const p of portfolios) {
    let offset: number | null = 0;
    do {
      if (++pages > 20) return { largest: null, reason: 'Holdings exceed the local context limit. Select a portfolio.' };
      const page = await call('listHoldings', { portfolioId: p.id, limit: 50, offset });
      positions.push(...page.holdings);
      offset = page.meta.page.nextOffset;
    } while (offset !== null);
  }
  const largest = largestHolding(positions);
  return { largest, reason: largest ? null : 'No open holdings, or missing/stale quotes prevent a complete market-value ranking.', calculation: 'domain.largestHolding: exact sum by security across scoped active portfolios' };
}

/** One article this run actually read through the authorized `getNewsArticle` tool. */
export interface ResearchEvidence {
  source: ChatSource;
  /** Securities the tool linked to the article, with the owner's relation (held > watchlisted > mentioned). */
  securities: Array<{ securityId: string; symbol: string; relation: 'held' | 'watchlisted' | 'mentioned' }>;
}

/** Per-run, bounded evidence registry populated ONLY after successful authorized tool reads. */
export function researchContext(tools: PortfolioToolContext) {
  const evidence = new Map<string, ResearchEvidence>();
  const observed: PortfolioToolContext = { ...tools, onResult(name, value) {
    tools.onResult?.(name, value);
    if (name !== 'getNewsArticle') return;
    const article = value.article as Record<string, unknown> | undefined;
    if (!article || evidence.size >= 30) return;
    const url = typeof article.url === 'string' ? validatedSourceUrl(article.url) : null;
    const parsed = chatSourceSchema.safeParse({ articleId: article.id, title: article.title, url, publishedAt: article.publishedAt, isSynthetic: article.isSynthetic });
    if (!parsed.success) return;
    const held = new Map<string, string>();
    for (const impact of (value.relatedHoldings ?? []) as Array<{ positions?: Array<{ securityId: string; symbol: string }> }>) for (const p of impact.positions ?? []) held.set(p.securityId, p.symbol);
    const watchlisted = new Set((value.watchlistedSecurityIds ?? []) as string[]);
    const securities = new Map<string, ResearchEvidence['securities'][number]>();
    for (const s of (article.securities ?? []) as Array<{ id: string; symbol: string }>) securities.set(s.id, { securityId: s.id, symbol: s.symbol, relation: held.has(s.id) ? 'held' : watchlisted.has(s.id) ? 'watchlisted' : 'mentioned' });
    for (const [securityId, symbol] of held) securities.set(securityId, { securityId, symbol, relation: 'held' });
    evidence.set(parsed.data.articleId, { source: parsed.data, securities: [...securities.values()] });
  } };
  return { tools: observed, sources: () => [...evidence.values()].map(e => e.source), evidence: () => new Map(evidence) };
}

/**
 * The "authorized summary" that seeds a NEW SDK session when the recorded one cannot be resumed.
 * Built by the server only from the owner's persisted, completed messages and their validated
 * sources; it is a bounded digest, not a transcript, and the prompt says so.
 */
export interface ConversationSeed {
  kind: 'application_summary';
  note: string;
  earlierTurnsOmitted: number;
  /** Exact historical user requests retain portfolio selections/names that excerpts might lose. */
  scopeRequests: Array<{ messageId: string; content: string; createdAt: string }>;
  turns: Array<{ role: 'user' | 'assistant'; kind: ChatRunKind; content: string }>;
  citedSources: Array<ChatSource>;
}
export function conversationSeed(history: ChatMessage[]): ConversationSeed | null {
  const completed = history.filter(m => m.status === 'completed');
  if (!completed.length) return null;
  const turns = completed.slice(-8).map(m => ({ role: m.role, kind: m.kind, content: m.content.length > 1000 ? `${m.content.slice(0, 999)}…` : m.content }));
  const cited = new Map<string, ConversationSeed['citedSources'][number]>();
  for (const m of completed) for (const s of m.sources) { cited.delete(s.articleId); cited.set(s.articleId, s); }
  return { kind: 'application_summary', note: 'Historical analysis only, not fresh market data. Built from owned saved messages; shortened turns are excerpts, not a transcript. Tool results and exact earlier reasoning are not included. Re-read articles, holdings and quotes with tools before relying on them. The current request and application portfolio scope always take precedence.',
    earlierTurnsOmitted: completed.length - turns.length,
    scopeRequests: completed.filter(m => m.role === 'user').map(m => ({ messageId: m.id, content: m.content, createdAt: m.createdAt })),
    turns, citedSources: [...cited.values()] };
}

export interface ResearchPromptInput {
  portfolioId: string | null;
  content: string;
  kind?: ChatRunKind;
  /** How the SDK session relates to earlier turns. Undefined: no session handling (bounded history only). */
  continuity?: 'new' | 'resumed' | 'reseeded';
  history?: ChatMessage[];
  seed?: ConversationSeed | null;
  /** Sanitized validation issues for a bounded structured-output retry. */
  correction?: string[];
}

/** Inputs are owner-scoped DB DTOs and an owner-bound tool context, not arbitrary request IDs. */
export async function buildResearchPrompt(context: PortfolioToolContext, input: ResearchPromptInput): Promise<string> {
  const { portfolioId, content, kind = 'answer', continuity, history = [], seed = null, correction } = input;
  let scope: unknown = { activePortfolios: true };
  if (portfolioId) {
    const tool = createPortfolioTools(context).find(t => t.name === 'getPortfolioSummary')!;
    const result = await tool.handler({ portfolioId }, undefined);
    if (result.isError) throw new Error('Authorized portfolio scope unavailable.');
    if ((result.structuredContent?.meta as { truncated?: boolean } | undefined)?.truncated) throw new AgentRunFailure('scope_limit');
    scope = result.structuredContent;
  }
  const ranking = /\blargest\b/i.test(content) ? await retrieveLargestHolding(context, portfolioId) : null;
  if (ranking?.reason && /scope is truncated|context limit/.test(ranking.reason)) throw new AgentRunFailure('scope_limit');
  const base = { kind: 'untrusted_research_request_data', task: kind, asOf: (context.now ?? (() => new Date()))().toISOString(), portfolioId, scope, ranking };
  // JSON encoding prevents delimiter breakouts. It is still data, never a policy boundary.
  if (continuity === undefined) {
    const turns = history.filter(m => m.status === 'completed').slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    return JSON.stringify({ ...base, history: turns, historyTruncated: history.length > 8 || history.some(m => m.content.length > 2000), request: content });
  }
  // A resumed session already holds the earlier turns: they are not sent again.
  return JSON.stringify({ ...base, continuity, ...(continuity === 'reseeded' ? { seed } : {}), ...(correction ? { correction } : {}), request: content });
}
