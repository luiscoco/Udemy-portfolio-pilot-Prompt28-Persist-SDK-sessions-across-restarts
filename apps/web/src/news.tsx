import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { newsDetailSchema, newsFeedSchema, newsReadResultSchema, type NewsFeed, type NewsFeedItem } from '@portfolio-pilot/contracts';
import { apiRequest } from './lib/api-client';
import { dateTime } from './lib/format';
import { money, percent, quantity } from './lib/decimal-display';
import { newsText, sourceLink } from './lib/news-content';
import { usePortfolios } from './portfolio';
import { useNewsNotices } from './streaming';
import { ArticleImpactPanel } from './research';

function SourceLink({ url }: { url: string }) {
  const href = sourceLink(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open canonical source (new tab)</a> : <span>Source link unavailable</span>;
}
function Metadata({ article: a }: { article: NewsFeedItem }) {
  return <><p>{newsText(a.source ?? a.provider)} · {a.isSynthetic ? 'MOCK · Synthetic' : 'Provider data'} · {a.isDelayed === null ? 'Delay unknown' : a.isDelayed ? `Delayed ${a.delayMs ?? 0} ms` : 'No declared upstream delay'} · Polling is near-real-time</p>
    <p>Published <time dateTime={a.publishedAt}>{dateTime(a.publishedAt)}</time><br />Ingested <time dateTime={a.ingestedAt ?? a.updatedAt}>{dateTime(a.ingestedAt ?? a.updatedAt)}</time>{a.providerAt && <><br />Provider updated {dateTime(a.providerAt)}</>}</p>
    <p>Related securities: {a.securities.map(s => `${s.symbol} / ${s.exchangeMic}`).join(' · ') || 'None identified'} · Revision {a.revision}</p></>;
}
export function NewsPage() {
  const [filter, setFilter] = useState('all');
  const portfolios = usePortfolios();
  return <><div className="page-title"><span className="eyebrow">MARKET PULSE</span><h1>News</h1><p>Portfolio and watchlist reporting. App delivery does not remove provider delays. Mock stories are fictional.</p></div>
    <label>News filter<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All portfolios and watchlist</option><option value="watchlist">Watchlist only</option>{portfolios.data?.portfolios.filter(p => !p.archivedAt).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
    {portfolios.error && <p role="alert">Portfolio filters unavailable.</p>}<NewsFeedView key={filter} filter={filter} /></>;
}
function NewsFeedView({ filter }: { filter: string }) {
  const notices = useNewsNotices();
  const [acceptedSequence, setAcceptedSequence] = useState(() => notices.at(-1)?.sequence ?? 0);
  const portfolioId = ['all', 'watchlist'].includes(filter) ? null : filter;
  const scope = filter === 'watchlist' ? 'watchlist' : 'all';
  const key = scope === 'all' ? ['news', portfolioId] : ['news', null, scope];
  const params = new URLSearchParams();
  if (portfolioId) params.set('portfolioId', portfolioId);
  if (scope === 'watchlist') params.set('scope', scope);
  const path = `/api/news${params.size ? `?${params}` : ''}` as const;
  const head = useQuery({ queryKey: key, queryFn: ({ signal }) => apiRequest(path, newsFeedSchema, { signal }) });
  const [visible, setVisible] = useState<NewsFeed | null>(null);
  const [baseline, setBaseline] = useState<NewsFeed | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const more = useQuery({ queryKey: [...key, 'page', cursor], enabled: !!cursor, queryFn: ({ signal }) => apiRequest(`/api/news?${new URLSearchParams({ ...Object.fromEntries(params), cursor: cursor! })}`, newsFeedSchema, { signal }) });
  useEffect(() => { if (!visible && head.data) { setVisible(head.data); setBaseline(head.data); } }, [head.data, visible]);
  useEffect(() => {
    if (!cursor || !more.data) return;
    const page = more.data;
    setVisible(old => old ? { ...old, nextCursor: page.nextCursor, articles: [...old.articles, ...page.articles.filter(a => !old.articles.some(b => b.id === a.id))] } : old);
    setCursor(null); // Disable this page query after appending; SSE cannot append rows implicitly.
  }, [more.data, cursor]);
  // Keep the displayed rows and text stable, including corrections, until the reader opts in.
  const updates = head.data && visible ? head.data.articles.filter(a => !visible.articles.some(b => b.id === a.id && b.updatedAt === a.updatedAt)) : [];
  const removed = baseline && head.data ? baseline.articles.filter(a => !head.data!.articles.some(b => b.id === a.id)).length : 0;
  // Surface notifications for older pages too; the bounded list never contains article text.
  const pendingIds = notices.filter(n => n.sequence > acceptedSequence && (filter === 'all' || (filter === 'watchlist' ? n.watchlisted : n.portfolioIds.includes(filter)))).map(n => n.articleId);
  const count = new Set([...updates.map(a => a.id), ...pendingIds]).size || removed;
  return <section className="card" aria-label="Portfolio and watchlist news"><h2 ref={heading} tabIndex={-1}>Portfolio and watchlist news</h2>
    <div className="news-update-slot"><span role="status" aria-live="polite" aria-atomic="true">{count ? `${count} new, updated or removed articles available.` : 'Feed up to date.'}</span>{count > 0 && <button disabled={head.isFetching || head.isError} onClick={() => { if (head.data) { setVisible(head.data); setBaseline(head.data); setAcceptedSequence(notices.at(-1)?.sequence ?? 0); setCursor(null); heading.current?.focus({ preventScroll: true }); } }}>Show updates</button>}</div>
    {head.isPending && !visible && <p role="status">Loading news…</p>}{head.error && <p role="alert">News unavailable. Retained articles may be stale. <button onClick={() => void head.refetch()}>Retry</button></p>}
    <div className="news-list">{visible?.articles.map(a => <article className="news-item" key={a.id}><h3><button className="news-title-button" onClick={() => setSelected(a.id)}>{newsText(a.title)}</button></h3><p>{newsText(a.summary)}</p><Metadata article={a} /><p>{a.readAt && a.readRevisionAt === a.updatedAt ? 'Read' : a.readAt ? 'Updated since you read it' : 'Unread'}</p><SourceLink url={a.url} /></article>)}</div>
    {visible?.articles.length === 0 && <p>No relevant stories yet.</p>}
    {visible?.nextCursor && <button disabled={more.isFetching} onClick={() => { if (cursor === visible.nextCursor) void more.refetch(); else setCursor(visible.nextCursor); }}>Load more articles</button>}
    {more.error && <p role="alert">Could not load more. <button onClick={() => void more.refetch()}>Retry</button></p>}
    {selected && <NewsDetail id={selected} close={() => setSelected(null)} onRead={read => setVisible(old => old ? { ...old, articles: old.articles.map(a => a.id === selected ? { ...a, ...read } : a) } : old)} />}
  </section>;
}
function NewsDetail({ id, close, onRead }: { id: string; close: () => void; onRead: (read: { readAt: string; readRevisionAt: string }) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['news-detail', id], queryFn: ({ signal }) => apiRequest(`/api/news/${encodeURIComponent(id)}`, newsDetailSchema, { signal }) });
  useEffect(() => { const prior = document.activeElement as HTMLElement; const node = dialog.current!; node.showModal(); return () => { node.close(); prior?.focus({ preventScroll: true }); }; }, []);
  async function markRead() {
    setBusy(true); setError(null);
    try { const read = await apiRequest(`/api/news/${encodeURIComponent(id)}/read`, newsReadResultSchema, { method: 'POST' }); onRead(read); await Promise.all([cache.invalidateQueries({ queryKey: ['news-detail', id] }), cache.invalidateQueries({ queryKey: ['news'] })]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark read'); } finally { setBusy(false); }
  }
  const data = query.data;
  return <dialog ref={dialog} aria-labelledby="news-detail-title" onCancel={e => { e.preventDefault(); close(); }}><h2 id="news-detail-title">News detail</h2><button onClick={close}>Close news detail</button>
    {query.isPending && <p role="status">Loading article…</p>}{query.error && <p role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Retry</button></p>}{data && <>
      <h3>{newsText(data.article.title)}</h3><p className="news-content">{newsText(data.article.summary)}</p><Metadata article={data.article} /><SourceLink url={data.article.url} />
      <p>{data.article.readRevisionAt === data.article.updatedAt ? 'Read this revision' : 'This revision is unread'}</p><button disabled={busy} onClick={() => void markRead()}>Mark article read</button>{error && <p role="alert">{error}</p>}
      <section aria-label="Portfolio impact"><h3>Portfolio impact</h3><p>Related exposure from your current holdings. Reporting alone does not establish a price effect.</p>{data.impacts.map(p => <div key={p.portfolioId}><h4>{p.name}</h4><p>Valuation as of {dateTime(p.asOf)}</p>{p.positions.map(s => <p key={s.securityId}>{s.security.symbol} / {s.security.exchangeMic}: {quantity(s.remainingQuantity)} shares · Value {s.marketValue === null ? 'Unavailable' : money(s.marketValue)} · Allocation {percent(s.allocationWeight)} · Quote {s.quoteStatus}{s.quote && ` · ${s.quote.isSynthetic ? 'Synthetic' : s.quote.provider} · ${dateTime(s.quote.asOf)}`}</p>)}</div>)}{data.impacts.length === 0 && <p>No current holdings in related securities.</p>}{data.watchlisted.length > 0 && <p>Also on your watchlist: {data.article.securities.filter(s => data.watchlisted.includes(s.id)).map(s => `${s.symbol} / ${s.exchangeMic}`).join(', ')}</p>}</section>
      <ArticleImpactPanel articleId={id} />
      <section aria-label="Correction provenance"><h3>Source and correction history</h3><p>Immutable observations, newest provider timestamp first (up to 100). Older deliveries do not replace fresher reporting.</p>{data.provenance.map(p => <div key={p.id}><p>{newsText(p.source)} · Record {newsText(p.recordId)} · Revision {p.revision} · {p.accepted ? 'Current displayed revision' : 'Historical observation'}<br />{newsText(p.title)}<br />Provider {dateTime(p.providerAt)} · Observed {dateTime(p.observedAt)}</p><SourceLink url={p.url} /></div>)}{data.provenance.length === 0 && <p>Seeded article; provider observation history unavailable.</p>}</section>
    </>}</dialog>;
}
