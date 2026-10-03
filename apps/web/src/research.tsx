import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { articleImpactResultSchema, recommendationListSchema, type ArticleImpact, type Recommendation, type RecommendationEvidence, type StaleReason } from '@portfolio-pilot/contracts';
import { z } from 'zod';
import { apiRequest } from './lib/api-client';
import { dateTime } from './lib/format';
import { money, percent, quantity } from './lib/decimal-display';
import { newsText, sourceLink } from './lib/news-content';

const TYPE_LABELS: Record<Recommendation['type'], string> = { monitor_event: 'Monitor event', review_concentration: 'Review concentration', read_primary_source: 'Read primary source', reassess_assumptions: 'Reassess assumptions' };
const STALE_LABELS: Record<StaleReason, string> = { article_corrected: 'the article was corrected', article_withdrawn: 'a cited article is no longer available', portfolio_changed: 'your holdings or watchlist changed', analysis_version_changed: 'the analysis model or prompt changed' };
const EVIDENCE_LABELS: Record<RecommendationEvidence['status'], string> = { current: 'Current revision', corrected: 'Corrected since this was written: the quoted text may be outdated', aged: 'Older than 72 hours', unavailable: 'No longer available' };
const BASIS = { market_value: 'market value (fresh quotes)', cost_basis: 'cost basis (at least one quote is not fresh)' } as const;
const reasons = (list: readonly StaleReason[]) => list.map(r => STALE_LABELS[r]).join('; ');

function Evidence({ evidence }: { evidence: RecommendationEvidence }) {
  const href = sourceLink(evidence.url);
  return <li><span className={evidence.status === 'current' ? undefined : 'evidence-flag'}>{EVIDENCE_LABELS[evidence.status]}</span> · {newsText(evidence.statement)}<br />
    {href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{newsText(evidence.title)} (new tab)</a> : <span>{newsText(evidence.title)}</span>} · published <time dateTime={evidence.publishedAt}>{dateTime(evidence.publishedAt)}</time></li>;
}

export function RecommendationCard({ recommendation: r, onDisposition }: { recommendation: Recommendation; onDisposition?: (value: 'saved' | 'dismissed' | 'new') => void }) {
  return <article data-recommendation-id={r.id} className="research-card" aria-label={`${TYPE_LABELS[r.type]} recommendation`}>
    <p className="eyebrow">{TYPE_LABELS[r.type].toUpperCase()}{r.status === 'stale' ? ' · OUT OF DATE' : ''}</p>
    <h4>{newsText(r.title)}</h4>
    <p>Status: {r.disposition} · evidence {r.status}</p>
    {onDisposition && <div><button onClick={() => onDisposition(r.disposition === 'saved' ? 'new' : 'saved')}>{r.disposition === 'saved' ? 'Unsave' : 'Save'}</button> <button onClick={() => onDisposition(r.disposition === 'dismissed' ? 'new' : 'dismissed')}>{r.disposition === 'dismissed' ? 'Restore' : 'Dismiss'}</button></div>}
    {r.status === 'stale' && <p className="data-state stale" role="note">Out of date because {reasons(r.staleReasons)}. Recalculate before relying on it.</p>}
    <p>{newsText(r.rationale)}</p>
    {r.affectedHoldings.length > 0 && <><h5>Affected holdings</h5><ul>{r.affectedHoldings.map(h => <li key={`${h.portfolioId}:${h.securityId}`}>{h.symbol} / {h.exchangeMic} in {newsText(h.portfolioName)}: {quantity(h.quantity)} shares · {money(h.value)} · {percent(h.weight)} of the portfolio ({h.valueBasis === 'market_value' ? 'market value' : 'cost basis'})</li>)}</ul></>}
    {r.affectedHoldings.length === 0 && <p>Affected: {r.affectedSecurities.map(s => `${s.symbol} (${s.relation})`).join(', ')}.</p>}
    <h5>Evidence</h5><ul>{r.evidence.map((e, i) => <Evidence key={`${e.articleId}:${i}`} evidence={e} />)}</ul>
    <details open><summary>Explanation and caveats</summary><h5>Uncertainties</h5><ul>{r.uncertainties.map((u, i) => <li key={i}>{newsText(u)}</li>)}</ul>
    <h5>Counterarguments</h5><ul>{r.counterarguments.map((c, i) => <li key={i}>{newsText(c)}</li>)}</ul>
    <p className="research-meta">Reporting tone: {r.sentiment.label}. {r.sentiment.note} As of <time dateTime={r.asOf}>{dateTime(r.asOf)}</time> · rules {r.provenance.generatorVersion} · analysis {r.provenance.promptVersion} / {r.provenance.modelKey}</p>
    </details>
  </article>;
}

function stateText(impact: ArticleImpact): { tone: '' | 'stale' | 'error'; text: string } {
  switch (impact.state) {
    case 'not_analyzed': return { tone: '', text: 'Not analyzed yet. The article analysis is shared and contains only public article data; your holdings are combined with it afterwards and never sent to the model.' };
    case 'pending': return { tone: 'stale', text: 'This article is being analyzed by another request. Try again shortly.' };
    case 'unsupported_source': return { tone: 'error', text: 'This source is not supported as evidence, so no new analysis or recommendation is produced. Previous results below are out of date.' };
    case 'analysis_failed': return { tone: 'error', text: `The current shared analysis was rejected (${impact.failureCode ?? 'unknown'}). Previous results below may be out of date. It will not be retried for a few minutes.` };
    case 'stale': return { tone: 'stale', text: `Out of date because ${reasons(impact.staleReasons)}. Recalculate to update.` };
    default: return { tone: '', text: `Up to date as of ${impact.computedAt ? dateTime(impact.computedAt) : 'now'}.` };
  }
}

/** Pure view, so it can be rendered without a network in tests. */
export function ImpactView({ impact, busy = false, error = null, onRecalculate, onDisposition }: { impact: ArticleImpact; busy?: boolean; error?: string | null; onRecalculate?: () => void; onDisposition?: (id: string, value: 'saved' | 'dismissed' | 'new') => void }) {
  const state = stateText(impact);
  const exposure = impact.exposure;
  const analysis = impact.analysis;
  return <>
    <p className={`data-state${state.tone ? ` ${state.tone}` : ''}`} role="status">{state.text}</p>
    {impact.state !== 'unsupported_source' && onRecalculate && <button disabled={busy} onClick={onRecalculate}>{busy ? 'Analyzing…' : impact.state === 'not_analyzed' ? 'Analyze impact' : 'Recalculate impact'}</button>}
    {error && <p role="alert">{error}</p>}
    {exposure && <div><h4>Your exposure</h4>
      <p>{exposure.relevance === 'held' ? `Held: ${money(exposure.affectedValue)} of ${money(exposure.totalValue)} (${percent(exposure.weight)}) across your active portfolios.` : exposure.relevance === 'watchlisted' ? 'On your watchlist; not currently held.' : 'Not related to your holdings or watchlist.'}{exposure.basis && ` Weights use ${BASIS[exposure.basis]}.`}</p>
      {exposure.portfolios.map(p => <p key={p.portfolioId}>{newsText(p.name)}: {money(p.affectedValue)} of {money(p.totalValue)} ({percent(p.weight)})</p>)}
      <p>Concentration review threshold: {percent(exposure.concentrationThreshold)} of a portfolio.</p></div>}
    {analysis?.analysis && <p className="research-meta">Shared article analysis: tone {analysis.analysis.sentiment.label}, materiality {analysis.analysis.materiality}, events {analysis.analysis.eventCategories.join(', ').replace(/_/g, ' ')} · {analysis.modelKey} · {analysis.promptVersion} · {analysis.completedAt ? `analyzed ${dateTime(analysis.completedAt)}` : 'not completed'}{analysis.supersededAt ? ' · superseded by a later article revision' : ''}{impact.analysisReused ? ' · reused from the shared cache' : ''}</p>}
    {impact.state === 'current' && impact.recommendations.length === 0 && <p>No research action suggested for this article.</p>}
    {impact.recommendations.filter(r => r.disposition !== 'dismissed').map(r => <RecommendationCard key={r.id} recommendation={r} {...(onDisposition ? { onDisposition: (value: 'saved' | 'dismissed' | 'new') => onDisposition(r.id, value) } : {})} />)}
    <p className="research-meta">Research steps only: never trade instructions or price targets. No trade is placed.</p>
  </>;
}

export function ArticleImpactPanel({ articleId }: { articleId: string }) {
  const cache = useQueryClient();
  const key = ['news-impact', articleId];
  const path = `/api/news/${encodeURIComponent(articleId)}/impact` as const;
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => apiRequest(path, articleImpactResultSchema, { signal }) });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function recalculate() {
    setBusy(true); setError(null);
    // A live model analysis can take longer than an ordinary read.
    try { cache.setQueryData(key, await apiRequest(path, articleImpactResultSchema, { method: 'POST', timeoutMs: 60000 })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not analyze impact'); } finally { setBusy(false); }
  }
  return <section aria-label="Research recommendations"><h3>Research recommendations</h3>
    {query.isPending && <p role="status">Loading impact…</p>}{query.error && <p role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data && <ImpactView impact={query.data.impact} busy={busy} error={error} onRecalculate={() => void recalculate()} onDisposition={(id, value) => { void setDisposition(cache, id, value).catch(cause => setError(String(cause))); }} />}
  </section>;
}

async function setDisposition(cache: ReturnType<typeof useQueryClient>, id: string, disposition: 'saved' | 'dismissed' | 'new') {
  await apiRequest(`/api/recommendations/${encodeURIComponent(id)}`, z.object({ updated: z.literal(true) }), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disposition }) });
  await Promise.all([cache.invalidateQueries({ queryKey: ['recommendations'] }), cache.invalidateQueries({ queryKey: ['news-impact'] })]);
}

export function RecommendationHistory() {
  const cache = useQueryClient();
  const [status, setStatus] = useState('open'); const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['recommendations', status], queryFn: ({ signal }) => apiRequest(`/api/recommendations?status=${status}&limit=50`, recommendationListSchema, { signal }) });
  return <section className="card" aria-label="Recommendation history"><h2>Research recommendations</h2>
    <label>Show recommendations <select value={status} onChange={e => setStatus(e.target.value)}><option value="open">Open</option><option value="saved">Saved</option><option value="history">History including dismissed</option></select></label>
    {query.isPending && <p role="status">Loading recommendations…</p>}{query.error && <p role="alert">{query.error.message}</p>}{error && <p role="alert">{error}</p>}
    {query.data?.recommendations.length === 0 && <p role="status">{status === 'saved' ? 'No saved recommendations yet.' : status === 'history' ? 'No recommendation history yet. No relevant news has produced a research action.' : 'No relevant news requiring a research action. New relevant news is evaluated when delivered; no analysis is generated just to fill this space.'}</p>}
    {query.data?.recommendations.map(r => <RecommendationCard key={r.id} recommendation={r} onDisposition={value => { setError(null); void setDisposition(cache, r.id, value).catch(cause => setError(String(cause))); }} />)}
  </section>;
}

