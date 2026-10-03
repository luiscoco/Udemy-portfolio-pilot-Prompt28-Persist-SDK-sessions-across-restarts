import { z } from 'zod';
import { newsAnalysisSchema, type AnalysisFailureCode, type NewsAnalysis } from '@portfolio-pilot/contracts';
import type { ResearchEvidence } from './research-context.js';

/** Draft-07 JSON Schema for the documented `outputFormat` (the SDK validates draft-07). */
export const NEWS_ANALYSIS_OUTPUT_SCHEMA = z.toJSONSchema(newsAnalysisSchema, { target: 'draft-7' }) as Record<string, unknown>;

/**
 * Bounded retry policy. The SDK already re-prompts on JSON Schema mismatch; these are the server's
 * additional attempts after its own validation fails (schema AND references). Two attempts in total.
 */
export const ANALYSIS_POLICY = { maxAttempts: 2, maxIssues: 8, futureSkewMs: 5 * 60_000 } as const;

export type AnalysisValidation =
  | { ok: true; analysis: NewsAnalysis }
  | { ok: false; code: Exclude<AnalysisFailureCode, 'analysis_no_output' | 'analysis_retries_exhausted'>; issues: string[] };

/** Issue text names only paths and rule names, never model text, so it is safe to log and to send back. */
const pathOf = (path: readonly PropertyKey[]) => path.map(String).join('.') || '(root)';

/**
 * Validates untrusted `structured_output` against the contract AND against the evidence this run
 * actually read. Never `JSON.parse`/cast-and-use: the value is parsed with Zod, then every article ID,
 * evidence URL and security is checked against the per-run registry built from authorized tool results.
 * Precedence: structure, then unknown sources, then missing references.
 * On success, article titles come from the registry (the model cannot retitle a source).
 */
export function validateNewsAnalysis(raw: unknown, evidence: ReadonlyMap<string, ResearchEvidence>, now: Date): AnalysisValidation {
  const issues: string[] = [];
  const parsed = newsAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: 'analysis_invalid_structure', issues: parsed.error.issues.slice(0, ANALYSIS_POLICY.maxIssues).map(i => `${pathOf(i.path)}: ${i.code}`) };
  }
  const analysis = parsed.data;
  const asOf = Date.parse(analysis.asOf);
  if (asOf > now.getTime() + ANALYSIS_POLICY.futureSkewMs) issues.push('asOf: in the future');
  for (const [i, a] of analysis.articles.entries()) if (evidence.has(a.articleId) && Date.parse(a.publishedAt) > asOf) issues.push(`articles.${i}.publishedAt: after asOf`);
  if (issues.length) return { ok: false, code: 'analysis_invalid_structure', issues };

  // Unknown sources: every reference anywhere must be an article this run read through the tools.
  const unknown = (path: string, id: string) => { if (!evidence.has(id)) issues.push(`${path}: unknown article`); };
  analysis.articles.forEach((a, i) => {
    unknown(`articles.${i}.articleId`, a.articleId);
    const known = evidence.get(a.articleId);
    if (known && Date.parse(known.source.publishedAt) !== Date.parse(a.publishedAt)) issues.push(`articles.${i}.publishedAt: does not match the article`);
  });
  analysis.evidence.forEach((e, i) => {
    unknown(`evidence.${i}.articleId`, e.articleId);
    const known = evidence.get(e.articleId);
    if (known && known.source.url !== e.url) issues.push(`evidence.${i}.url: does not match the article URL`);
  });
  const claims = [
    ...analysis.events.map((c, i) => [`events.${i}`, c.articleIds] as const),
    ...analysis.affectedSecurities.map((c, i) => [`affectedSecurities.${i}`, c.articleIds] as const),
    ...analysis.factualSummary.map((c, i) => [`factualSummary.${i}`, c.articleIds] as const),
    ...analysis.interpretations.map((c, i) => [`interpretations.${i}`, c.articleIds] as const),
    ...analysis.uncertainties.map((c, i) => [`uncertainties.${i}`, c.articleIds] as const)
  ];
  for (const [path, ids] of claims) ids.forEach((id, j) => unknown(`${path}.articleIds.${j}`, id));
  analysis.affectedSecurities.forEach((s, i) => {
    for (const id of s.articleIds) {
      const linked = evidence.get(id)?.securities.find(x => x.securityId === s.securityId);
      if (evidence.has(id) && !linked) issues.push(`affectedSecurities.${i}.securityId: not linked to the cited article`);
      else if (linked && (linked.symbol !== s.symbol || linked.relation !== s.relation)) issues.push(`affectedSecurities.${i}: symbol or relation does not match the tools`);
    }
  });
  if (issues.length) return { ok: false, code: 'analysis_unknown_source', issues: [...new Set(issues)].slice(0, ANALYSIS_POLICY.maxIssues) };

  // Missing references: every claim (except uncertainties, which may concern absent evidence) cites
  // at least one article, and every cited article is listed with an evidence link.
  const listed = new Set(analysis.articles.map(a => a.articleId));
  const linked = new Set(analysis.evidence.map(e => e.articleId));
  for (const [path, ids] of claims) {
    if (!ids.length && !path.startsWith('uncertainties')) issues.push(`${path}.articleIds: empty`);
    ids.forEach((id, j) => { if (!listed.has(id)) issues.push(`${path}.articleIds.${j}: not listed in articles`); });
  }
  analysis.articles.forEach((a, i) => { if (!linked.has(a.articleId)) issues.push(`articles.${i}: no evidence link`); });
  if (issues.length) return { ok: false, code: 'analysis_missing_references', issues: [...new Set(issues)].slice(0, ANALYSIS_POLICY.maxIssues) };

  return { ok: true, analysis: { ...analysis, articles: analysis.articles.map(a => ({ ...a, title: evidence.get(a.articleId)!.source.title })) } };
}

/** The correction a bounded retry sends: rule names and paths only (no IDs or text are echoed back). */
export function analysisCorrection(result: Extract<AnalysisValidation, { ok: false }>): string[] {
  return [`The previous structured output was rejected by the application (${result.code}). Fix these fields; cite only articles you read with getNewsArticle in this turn, using the exact tool URL.`, ...result.issues];
}

const bullet = (statement: string, ids: readonly string[]) => `- ${statement.replace(/\s+/g, ' ')}${ids.length ? ` (${ids.map(id => `[${id}]`).join(', ')})` : ''}`;
/**
 * Deterministic Markdown for the chat transcript, rendered only from a VALIDATED analysis. Source
 * links use registry URLs, which the browser's link check accepts because they are also the message's
 * validated sources. Model text is still untrusted: the browser escapes it and never renders HTML.
 */
export function renderNewsAnalysis(analysis: NewsAnalysis, evidence: ReadonlyMap<string, ResearchEvidence>): string {
  // Blocks are separated by blank lines: a heading, then its list (the browser grammar is block-based).
  const section = (heading: string, items: string[]) => `### ${heading}\n\n${items.join('\n')}`;
  const sections = [`**Structured news analysis** · as of ${analysis.asOf} UTC`, section('Facts', analysis.factualSummary.map(f => bullet(f.statement, f.articleIds)))];
  if (analysis.events.length) sections.push(section('Events', analysis.events.map(e => bullet(`${e.category.replace(/_/g, ' ')}: ${e.description}`, e.articleIds))));
  if (analysis.affectedSecurities.length) sections.push(section('Affected securities', analysis.affectedSecurities.map(s => bullet(`${s.symbol} (${s.relation})`, s.articleIds))));
  sections.push(section('Interpretation', analysis.interpretations.length ? analysis.interpretations.map(i => bullet(`${i.statement} Confidence: ${i.confidence}.`, i.articleIds)) : ['- No interpretation is offered beyond the cited facts.']));
  sections.push(section('Uncertainties', analysis.uncertainties.map(u => bullet(u.statement, u.articleIds))));
  sections.push(section('Sources', analysis.articles.map(a => `- [${a.articleId}](${evidence.get(a.articleId)!.source.url}) ${a.title} · published ${a.publishedAt}${evidence.get(a.articleId)!.source.isSynthetic ? ' · synthetic' : ''}`)));
  return sections.join('\n\n');
}
