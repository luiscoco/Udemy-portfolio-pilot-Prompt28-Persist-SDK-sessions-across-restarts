import { useQuery } from '@tanstack/react-query';
import { marketSnapshotSchema } from '@portfolio-pilot/contracts';
import { apiRequest } from './lib/api-client';
import { dateTime } from './lib/format';
import { sourceLink, newsText } from './lib/news-content';

export function useMarket() {
  return useQuery({ queryKey: ['market'], queryFn: ({ signal }) => apiRequest('/api/market', marketSnapshotSchema, { signal }), refetchInterval: 5000, retry: false });
}
export function MarketStatus() {
  const query = useMarket(); const data = query.data;
  const expired = data?.fetchedAt && Date.now() - Date.parse(data.fetchedAt) > data.staleAfterMs;
  const status = query.isError || expired ? (data ? 'stale' : 'unavailable') : data?.status ?? 'loading';
  return <span role="status">{data ? `${data.mode.toUpperCase()} DATA · ${status}` : 'Provider mode unavailable'}{data?.mode === 'mock' && ' · Synthetic'}{data?.error && ` · ${data.error.replaceAll('_', ' ')}`}</span>;
}
function ProviderNews({ query, data }: { query: ReturnType<typeof useMarket>; data: ReturnType<typeof useMarket>['data'] }) {
  return <><h2>Provider samples</h2><p>Independent provider samples refreshed every 5 seconds. These do not update persisted news or valuations. Mock reporting is fictional.</p><section className="card"><h2>Latest stories</h2><MarketStatus />{query.isPending && <p role="status">Loading provider snapshot…</p>}{query.isError && <p role="alert">Provider connection unavailable. Retained values are stale.</p>}{data?.error && <p role="alert">Provider {data.error.replaceAll('_', ' ')}. {data.fetchedAt ? `Last successful fetch: ${dateTime(data.fetchedAt)}. Retained data is stale.` : 'No data available.'}{data.retryAt && ` Retry after ${dateTime(data.retryAt)}.`}</p>}{data && <><p>{data.providers.map(p => `${p.sourceId}: ${p.delivery}, ${p.timeliness} (${p.delayMs} ms delay)`).join(' · ')}</p><p>Snapshot: {dateTime(data.asOf)}. Last successful fetch: {data.fetchedAt ? `${dateTime(data.fetchedAt)}` : 'none'}.</p><div className="news-list">{data.articles.map(article => {
    const stale = query.isError || data.status !== 'fresh' || Date.parse(data.asOf) - Date.parse(article.providerAt) > data.staleAfterMs;
    const href = sourceLink(article.canonicalUrl);
    return <article className="news-item" key={`${article.sourceId}:${article.sourceRecordId}`}><div className="news-meta"><span>{article.category} · Revision {article.revision}</span><span>{stale ? 'Stale' : 'Fresh'} · {article.isSynthetic ? 'Synthetic' : 'Live'} · {article.isDelayed ? `Delayed ${article.delayMs} ms` : 'Real-time'}</span></div><h3>{href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{newsText(article.title)}</a> : newsText(article.title)}</h3><p>{newsText(article.summary)}</p><div className="news-foot"><span>{article.sourceId} · {article.symbols.join(' · ')}</span></div><small>Published {dateTime(article.publishedAt)} · Provider {dateTime(article.providerAt)} · Ingested {dateTime(article.ingestedAt)}</small></article>;
  })}</div>{!data.articles.length && <p>No news available yet.</p>}<h2>Provider quote sample</h2><p>These samples do not update persisted portfolio valuations.</p>{data.quotes.map(quote => <p key={quote.sourceRecordId}>{quote.security.symbol} / {quote.security.exchangeMic}: {quote.currency} {quote.price} · {query.isError || data.status !== 'fresh' ? 'Stale' : 'Fresh'} · {quote.isSynthetic ? 'Synthetic' : 'Live'} · {quote.isDelayed ? `Delayed ${quote.delayMs} ms` : 'Real-time'} · {quote.sourceId}<br /><small>Provider {dateTime(quote.providerAt)} · Ingested {dateTime(quote.ingestedAt)}</small></p>)}{data.missing.map(security => <p key={`${security.symbol}:${security.exchangeMic}`}>{security.symbol} / {security.exchangeMic}: Missing quote</p>)}</>}</section></>;
}
export function MarketSettings() {
  const query = useMarket();
  return <><MarketStatus /><p>Market mode is selected by server DATA_MODE. Provider polling and upstream delays apply even when app updates are Live. Live failures never fall back to synthetic data.</p><p>Mock news interval: {query.data?.intervalMs ?? 'unavailable'} ms. Browser provider snapshot polling: 5000 ms. Times are UTC; quote currency is provided per value.</p><ProviderNews query={query} data={query.data} /></>;
}
