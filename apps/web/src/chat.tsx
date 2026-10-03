import { isAgentEvent } from './lib/agent-runs';
import { agentRunChunksSchema, approvalListSchema, approvalResultSchema } from '@portfolio-pilot/contracts';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { activeAgentRunSchema, agentRunCreatedSchema, agentRunResultSchema, conversationPageSchema, conversationResultSchema, messagePageSchema, type AgentRun, type AgentToolName, type ChatMessage, type ChatRunKind, type ChatSource, type NewsAnalysis, type SessionContinuity } from '@portfolio-pilot/contracts';
import type { RunView } from './lib/agent-runs';
import { useAgentRun, useConnection, useStreamManager } from './streaming';
import { ApiError, apiRequest } from './lib/api-client';
import { ChatMarkdown, evidenceLink } from './chat-markdown';
import { usePortfolios } from './portfolio';

export function Assistant() {
  const cache = useQueryClient();
  const portfolios = usePortfolios();
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useInfiniteQuery({ queryKey: ['conversations'], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => apiRequest(`/api/conversations${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`, conversationPageSchema, { signal }),
    getNextPageParam: page => page.nextBefore ?? undefined });
  const conversations = list.data?.pages.flatMap(p => p.conversations) ?? [];
  const id = selected || conversations[0]?.id || '';
  /** A new conversation always starts a new assistant session; follow-ups stay in the selected one. */
  async function create(portfolioId: string | null) {
    setCreating(true); setError('');
    try {
      const result = await apiRequest('/api/conversations', conversationResultSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioId }) });
      // Select only after the list contains the new option, so the controlled select never points at a missing value.
      await cache.invalidateQueries({ queryKey: ['conversations'] }); setSelected(result.conversation.id);
    } catch (e) { setError((e as Error).message); } finally { setCreating(false); }
  }
  return <><div className="page-title"><span className="eyebrow">RESEARCH</span><h1>Assistant</h1><p>Research your authorized holdings and stored news with cited evidence. Quotes and news may be stale or synthetic.</p></div>
    <section className="card assistant-page"><label htmlFor="chat-scope">Scope for new conversation</label><select id="chat-scope" value={scope} onChange={e => setScope(e.target.value)}><option value="">All active portfolios</option>{portfolios.data?.portfolios.filter(p => !p.archivedAt).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button type="button" disabled={creating} onClick={() => void create(scope || null)}>New conversation</button>
      <label htmlFor="chat-conversation">Conversation</label><select id="chat-conversation" value={id} onChange={e => setSelected(e.target.value)}><option value="" disabled>Choose a conversation</option>{conversations.map(c => <option value={c.id} key={c.id}>{c.title} · {new Date(c.createdAt).toISOString()}</option>)}</select>
      {list.hasNextPage && <button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>More conversations</button>}
      {(error || list.error) && <p role="alert">{error || list.error?.message}</p>}
      {list.isPending && <p role="status">Loading conversations…</p>}
      {creating ? <p role="status">Creating conversation…</p> : id ? <ConversationView key={id} id={id} onNewConversation={() => void create(conversations.find(c => c.id === id)?.portfolioId ?? null)} /> : <p>Create a conversation to begin.</p>}
    </section></>;
}
const TOOL_LABELS: Record<AgentToolName, string> = { getPortfolioSummary: 'Reading portfolio summary', listHoldings: 'Reading holdings', listTransactions: 'Reading transactions',
  getQuotes: 'Reading quotes', searchNews: 'Searching stored news', getNewsArticle: 'Reading an article', delegation: 'Consulting a research specialist', researchExternal: 'Reading external research', other: 'Using a tool' };
const TOOL_STATES = { started: 'started', running: 'in progress', succeeded: 'done', failed: 'failed' } as const;
const STATUS_LABELS = { completed: '', failed: ' · Failed', cancelled: ' · Cancelled' } as const;
const RESEED_REASONS: Record<NonNullable<SessionContinuity['reason']>, string> = {
  not_recorded: 'earlier turns have no recorded assistant session',
  session_missing: 'the previous assistant session is no longer stored on this server',
  not_local: 'the previous assistant session belongs to another server process',
  configuration_changed: 'the assistant configuration changed since the previous session',
  resume_failed: 'resuming the previous assistant session failed',
  context_limit: 'the configured context window was reset; your portfolio scope is preserved and earlier analysis must be checked against fresh data'
};
/** Honest session continuity: a reseeded answer saw only a summary of earlier messages. */
export function ContinuityNote({ continuity }: { continuity: SessionContinuity | null }) {
  if (!continuity) return null;
  if (continuity.disposition === 'resumed') return <p className="continuity" data-continuity="resumed">Continued in the same assistant session.</p>;
  if (continuity.disposition === 'new') return <p className="continuity" data-continuity="new">New assistant session.</p>;
  return <p className="continuity continuity-reseeded" role="note" data-continuity="reseeded">New assistant session: {continuity.reason ? RESEED_REASONS[continuity.reason] : 'the previous session was unavailable'}. The assistant saw a summary of your saved messages, not the previous session itself.</p>;
}
function Refs({ ids, sources }: { ids: readonly string[]; sources: readonly ChatSource[] }) {
  if (!ids.length) return null;
  return <> ({ids.map((id, i) => { const source = sources.find(s => s.articleId === id); const href = source ? evidenceLink(source.url, sources) : null;
    return <span key={id}>{i > 0 && ', '}{href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{id}</a> : `${id} (unverified)`}</span>; })})</>;
}
/** Server-validated news-analysis-v1, shown by section; every reference resolves to a validated source. */
export function AnalysisView({ analysis, sources }: { analysis: NewsAnalysis; sources: readonly ChatSource[] }) {
  return <section className="analysis" aria-label="Structured news analysis">
    <p><strong>Structured news analysis</strong> · as of <time dateTime={analysis.asOf}>{analysis.asOf} UTC</time></p>
    <h3>Facts</h3><ul>{analysis.factualSummary.map((f, i) => <li key={i}>{f.statement}<Refs ids={f.articleIds} sources={sources} /></li>)}</ul>
    {analysis.events.length > 0 && <><h3>Events</h3><ul>{analysis.events.map((e, i) => <li key={i}><span className="analysis-tag">{e.category.replace(/_/g, ' ')}</span> {e.description}<Refs ids={e.articleIds} sources={sources} /></li>)}</ul></>}
    {analysis.affectedSecurities.length > 0 && <><h3>Affected securities</h3><ul>{analysis.affectedSecurities.map(s => <li key={s.securityId}>{s.symbol} · {s.relation}<Refs ids={s.articleIds} sources={sources} /></li>)}</ul></>}
    <h3>Interpretation</h3><ul>{analysis.interpretations.length ? analysis.interpretations.map((x, i) => <li key={i}>{x.statement} <em>Confidence: {x.confidence}.</em><Refs ids={x.articleIds} sources={sources} /></li>) : <li>No interpretation beyond the cited facts.</li>}</ul>
    <h3>Uncertainties</h3><ul>{analysis.uncertainties.map((u, i) => <li key={i}>{u.statement}<Refs ids={u.articleIds} sources={sources} /></li>)}</ul>
  </section>;
}

function MessageArticle({ m }: { m: ChatMessage }) {
  const who = m.role === 'user' ? (m.kind === 'news_analysis' ? 'You · Analyze news' : 'You') : m.mode === 'mock' ? 'Assistant · MOCK' : 'Assistant';
  return <article className="chat-answer" data-message-id={m.id} data-kind={m.kind}><strong>{who}{STATUS_LABELS[m.status]}</strong><time dateTime={m.createdAt}> · {m.createdAt} UTC</time>
    {m.role === 'assistant' && <ContinuityNote continuity={m.continuity} />}
    {m.usage && <p className="usage" aria-label="Assistant usage">{m.usage.accounting === 'not_started' ? 'No agent query started; no model charges.'
      : m.usage.accounting === 'mock' ? 'Mock run: no model charges.'
      : m.usage.accounting === 'conservative' ? 'Final usage is uncertain. The full daily reservation is retained conservatively.'
      : `Estimated model cost: $${m.usage.estimatedCostUsd}; ${m.usage.aggregateTokens} reported tokens. This is not a billing statement.`}
      {m.actualModel ? ` Runtime model: ${m.actualModel}.` : ''}</p>}
    {m.analysis ? <AnalysisView analysis={m.analysis} sources={m.sources} /> : <ChatMarkdown content={m.content} sources={m.sources} />}
    {m.sources.length > 0 && <ul aria-label="Validated article sources">{m.sources.map(s => <li key={s.articleId}><ChatMarkdown content={`[${s.articleId}](${s.url})`} sources={[s]} />{s.title} · Published {s.publishedAt}{s.isSynthetic ? ' · MOCK / synthetic' : ''}</li>)}</ul>}</article>;
}
const FOLLOW_UPS = ['Tell me more about the first cited article', 'Tell me more about the second cited article'];
/** The streamed draft: plain text until the authoritative message (with validated sources) replaces it. */
function DraftArticle({ view, messageId }: { view: RunView | undefined; messageId: string }) {
  if (view?.final) return <MessageArticle m={view.final} />;
  return <article className="chat-answer chat-draft" data-message-id={messageId} aria-busy="true" aria-label="Answer in progress">
    <strong>Assistant · Answering</strong>
    {view && view.tools.length > 0 && <ul className="tool-progress" aria-label="Tool progress">{view.tools.map(t => <li key={t.toolCallId} data-status={t.status}>{TOOL_LABELS[t.tool]} · {TOOL_STATES[t.status]}</li>)}</ul>}
    {view?.blocks.map(b => b.broken && !b.complete
      ? <p key={b.blockId} className="chat-gap">Part of this draft was missed while reconnecting. The complete answer appears when it finishes.</p>
      : <p key={b.blockId} className="chat-draft-text">{b.text}</p>)}
    {!view?.blocks.length && <p className="chat-gap">Waiting for the answer…</p>}
  </article>;
}

export function ApprovalCards({ runId }: { runId: string }) {
 const cache = useQueryClient();
 const [busy, setBusy] = useState('');
 const [error, setError] = useState('');
 const query = useQuery({ queryKey: ['approvals', runId], queryFn: ({ signal }) => apiRequest(`/api/runs/${encodeURIComponent(runId)}/approvals`, approvalListSchema, { signal }), refetchInterval: 1000 });
 async function decide(id: string, argumentHash: string, action: 'approve' | 'reject') {
  if (busy) return;
  setBusy(id); setError('');
  try {
   await apiRequest(`/api/approvals/${encodeURIComponent(id)}/${action}`, approvalResultSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ argumentHash }) });
   await query.refetch();
   await cache.invalidateQueries({ queryKey: ['chat-run'] });
  } catch (e) { setError((e as Error).message); await query.refetch(); }
  finally { setBusy(''); }
 }
 return <section aria-label="Proposed changes">{query.data?.approvals.map(a => <article className="card approval-card" key={a.id}>
  <h3>{a.actionType === 'watchlist.add' ? 'Add to watchlist' : 'Replace alert rule'}</h3>
  <p>Status: {a.status}. Expires <time dateTime={a.expiresAt}>{a.expiresAt} UTC</time>.</p>
  <h4>Current state when proposed</h4><pre>{JSON.stringify(a.before, null, 2)}</pre>
  <h4>Exact proposed change</h4><pre>{JSON.stringify(a.arguments, null, 2)}</pre>
  {a.status === 'pending' && <><p>This change requires your approval. Approval applies only to these exact arguments.</p>
   <button disabled={!!busy || Date.parse(a.expiresAt) <= Date.now()} onClick={() => void decide(a.id, a.argumentHash, 'approve')}>Approve change</button>
   <button disabled={!!busy} onClick={() => void decide(a.id, a.argumentHash, 'reject')}>Reject change</button></>}
  {a.status === 'invalidated' && <p>The run or resource changed. Send a new proposal to confirm again.</p>}
 </article>)}{(error || query.error) && <p role="alert">{error || query.error?.message}</p>}</section>;
}

function ConversationView({ id, onNewConversation }: { id: string; onNewConversation: () => void }) {
  const manager = useStreamManager();
  const connection = useConnection();
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState('');
  const [error, setError] = useState('');
  // The POST result, kept until the persisted assistant message replaces the draft.
  const [started, setStarted] = useState<AgentRun | null>(null);
  const history = useInfiniteQuery({ queryKey: ['chat-messages', id], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => apiRequest(`/api/conversations/${encodeURIComponent(id)}/messages${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`, messagePageSchema, { signal }),
    getNextPageParam: page => page.nextBefore ?? undefined });
  // Reconnection recovery, and the fallback when events are lost: poll the durable run while one is active.
  const active = useQuery({ queryKey: ['chat-run', id], queryFn: ({ signal }) => apiRequest(`/api/conversations/${encodeURIComponent(id)}/runs/active`, activeAgentRunSchema, { signal }),
    refetchInterval: query => query.state.data?.run || started ? (connection === 'Live' ? 5000 : 2000) : false });
  const unique = new Map<string, ChatMessage>();
  for (const page of [...(history.data?.pages ?? [])].reverse()) for (const message of page.messages) unique.set(message.id, message);
  const run = started ?? active.data?.run ?? null;
  const view = useAgentRun(run?.id ?? null);
  const chunks = useQuery({ queryKey: ['chat-run-chunks', run?.id], enabled: !!run,
    queryFn: ({ signal }) => apiRequest(`/api/runs/${encodeURIComponent(run!.id)}/chunks`, agentRunChunksSchema, { signal }),
    refetchInterval: run ? 2000 : false });
  useEffect(() => {
    if (!manager || !run || !chunks.data) return;
    // Rebuild from the bounded durable journal to repair sequence gaps, then reconcile SSE duplicates.
    manager.agentRuns.recover(run.id, chunks.data.events.filter(isAgentEvent));
  }, [manager, run?.id, chunks.data]);

  const persisted = run ? unique.has(run.assistantMessageId) : false;
  const answering = !!run && !persisted;
  // Finished per the event stream, or per a poll taken after this run started that no longer lists it.
  const polledDone = !!run && !!active.data && active.data.run?.id !== run.id && active.dataUpdatedAt > Date.parse(run.createdAt);
  const finished = !!view?.final || (!!view && !['queued','running','waiting_for_approval'].includes(view.status)) || polledDone;
  const refetchMessages = history.refetch;
  useEffect(() => { if (started && persisted) { setStarted(null); setCancelling(''); } }, [started, persisted]);
  // The run ended but the list does not show it yet: read the durable message.
  useEffect(() => { if (answering && finished) void refetchMessages(); }, [answering, finished, refetchMessages]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending || answering || !content.trim()) return;
    // Two submit buttons: an ordinary answer, or a structured, server-validated news analysis.
    const kind: ChatRunKind = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'news_analysis' ? 'news_analysis' : 'answer';
    setSending(true); setError('');
    try {
      const recoveries = manager?.recoveries ?? 0;
      const result = await apiRequest(`/api/conversations/${encodeURIComponent(id)}/runs`, agentRunCreatedSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, kind }), timeoutMs: 15000 });
      manager?.ensureReplay(recoveries, result.replayCursor);
      setStarted(result.run); setContent('');
      void refetchMessages();
    } catch (e) { setError(e instanceof ApiError && e.status === 429 ? e.message
      : `${(e as Error).message} Refresh messages before retrying; an accepted request may still be answering.`); }
    finally { setSending(false); }
  }
  async function cancel() {
    if (!run) return;
    setCancelling(run.id); setError('');
    try { await apiRequest(`/api/runs/${encodeURIComponent(run.id)}/cancel`, agentRunResultSchema, { method: 'POST' }); void active.refetch(); }
    catch (e) { setCancelling(''); setError((e as Error).message); }
  }
  const messages = [...unique.values()];
  const hasAnswers = messages.some(m => m.role === 'assistant' && m.status === 'completed');
  const lastAnswer = [...messages].reverse().find(m => m.role === 'assistant');
  const status = sending ? 'Starting…' : !answering ? '' : cancelling === run?.id ? 'Cancelling…' : finished ? 'Saving the answer…' : active.data?.run?.status === 'waiting_for_approval' ? 'Waiting for your approval. You can reject the change or cancel this answer.' : 'Answering… You can leave this page; the answer is saved when it finishes.';
  return <div className="chat-panel">
    {history.hasNextPage && <button type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Load earlier messages</button>}
    <button type="button" onClick={() => { void history.refetch(); void active.refetch(); }}>Refresh messages</button>
    {history.isPending && <p role="status">Loading messages…</p>}
    {history.error && <p role="alert">{history.error.message}</p>}
    <div aria-label="Conversation messages">{[...unique.values()].map(m => <MessageArticle key={m.id} m={m} />)}{answering && run && <DraftArticle key={run.id} view={view} messageId={run.assistantMessageId} />}</div>
    {run && <ApprovalCards runId={run.id} />}
    {answering && !finished && <button type="button" className="cancel-run" disabled={cancelling === run?.id} onClick={() => void cancel()}>Cancel answer</button>}
    {!answering && lastAnswer?.status === 'completed' && lastAnswer.sources.length > 0 && <div className="follow-ups" role="group" aria-label="Suggested follow-up questions">
      {FOLLOW_UPS.slice(0, lastAnswer.sources.length).map(text => <button type="button" key={text} onClick={() => setContent(text)}>{text}</button>)}</div>}
    <form onSubmit={send}><label htmlFor="chat-question">{hasAnswers ? 'Ask a follow-up in this conversation' : 'Ask about your portfolio'}</label><div className="chat-input"><textarea id="chat-question" value={content} onChange={e => setContent(e.target.value)} maxLength={2000} required placeholder={hasAnswers ? 'Tell me more about the first cited article' : 'Which recent news affects my largest holding?'} />
      <button disabled={sending || answering || !content.trim()} type="submit" value="answer">Send</button>
      <button disabled={sending || answering || !content.trim()} type="submit" value="news_analysis" className="analyze-button">Analyze news</button></div></form>
    <p role="status" aria-label="Answer status">{status}</p>{error && <p role="alert">{error}</p>}
    <button type="button" className="text-button" disabled={sending || answering} onClick={onNewConversation}>Start a new conversation with the same scope</button>
    <p>Follow-ups continue this conversation's assistant session when it is still stored on this server; otherwise the answer says it started a new session from a summary. A new conversation always starts fresh. <em>Analyze news</em> returns a structured analysis that is checked against the articles actually read. Largest means current USD market value. Recent means the last seven days. This assistant cannot execute trades.</p>
  </div>;
}
