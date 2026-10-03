import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { portfolioListSchema, portfolioResultSchema, portfolioSummaryResultSchema, securityListSchema, transactionHistorySchema, transactionResultSchema, transactionCreateSchema, watchlistListSchema, watchlistResultSchema, watchlistRemovalSchema, type PortfolioRecord, type PortfolioSummary } from '@portfolio-pilot/contracts';
import { apiRequest } from './lib/api-client';
import { money, percent, quantity } from './lib/decimal-display';
import { dateTime } from './lib/format';

export const usePortfolios = () => useQuery({ queryKey: ['portfolios'], queryFn: ({ signal }) => apiRequest('/api/portfolios', portfolioListSchema, { signal }) });
function Problem({ error, retry }: { error: Error; retry?: () => void }) { return <div role="alert" className="data-state error">{error.message}{retry && <button onClick={retry}>Try again</button>}</div>; }
export function Modal({ title, close, busy, children }: { title: string; close: () => void; busy: boolean; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current ??= document.activeElement as HTMLElement;
    const node = dialog.current!;
    node.showModal();
    return () => { node.close(); returnFocus.current?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}><h2 id="dialog-title">{title}</h2>{children}<button type="button" disabled={busy} onClick={close}>Cancel</button></dialog>;
}
function useSubmit() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause : new Error('Request failed.')); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, run };
}
function SecuritySelect({ value, setValue }: { value: string; setValue: (id: string) => void }) {
  const query = useQuery({ queryKey: ['securities'], queryFn: ({ signal }) => apiRequest('/api/securities', securityListSchema, { signal }) });
  return <><label>Security<select required value={value} onChange={event => setValue(event.target.value)} disabled={!query.data}><option value="">Select a USD stock</option>{query.data?.securities.map(s => <option key={s.id} value={s.id}>{s.symbol} · {s.exchangeMic} · {s.currency} · {s.name}</option>)}</select></label>{query.isPending && <p role="status">Loading securities…</p>}{query.error && <Problem error={query.error} retry={() => void query.refetch()} />}{query.data?.securities.length === 0 && <p>No supported securities available.</p>}</>;
}
function PortfolioDialog({ kind, portfolio, close, created }: { kind: 'create' | 'edit' | 'archive'; portfolio?: PortfolioRecord; close: () => void; created: (id: string) => void }) {
  const [name, setName] = useState(portfolio?.name ?? ''); const submit = useSubmit(); const cache = useQueryClient();
  const title = kind === 'create' ? 'Create portfolio' : kind === 'edit' ? 'Edit portfolio' : 'Archive portfolio';
  return <Modal title={title} close={close} busy={submit.busy}><form onSubmit={event => { event.preventDefault(); void submit.run(async () => {
    const result = await apiRequest(kind === 'create' ? '/api/portfolios' : `/api/portfolios/${portfolio!.id}`, portfolioResultSchema, { method: kind === 'create' ? 'POST' : kind === 'edit' ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json' }, ...(kind === 'archive' ? {} : { body: JSON.stringify({ name }) }) });
    await cache.invalidateQueries({ queryKey: ['portfolios'] }); await cache.invalidateQueries({ queryKey: ['summary', result.portfolio.id] }); created(result.portfolio.id); close();
  }); }}><fieldset disabled={submit.busy}>{kind === 'archive' ? <p>Archive “{portfolio?.name}”? It becomes read-only. Its holdings and transaction history remain available.</p> : <label>Portfolio name<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>}<button type="submit">{submit.busy ? 'Saving…' : kind === 'archive' ? 'Confirm archive' : 'Save portfolio'}</button></fieldset></form>{submit.error && <Problem error={submit.error} />}</Modal>;
}
function TradeDialog({ portfolioId, close }: { portfolioId: string; close: () => void }) {
  const [securityId, setSecurityId] = useState(''); const [side, setSide] = useState('BUY'); const [amount, setAmount] = useState(''); const [price, setPrice] = useState(''); const [fees, setFees] = useState('0'); const [time, setTime] = useState(new Date().toISOString().slice(0, 19));
  const attempt = useRef<{ body: string; key: string } | null>(null); const submit = useSubmit(); const cache = useQueryClient();
  const securities = useQuery({ queryKey: ['securities'], queryFn: ({ signal }) => apiRequest('/api/securities', securityListSchema, { signal }) });
  return <Modal title="Record transaction" close={close} busy={submit.busy}><p>Record an executed trade; this does not place an order. Entries are immutable.</p><form onSubmit={event => { event.preventDefault(); void submit.run(async () => {
    const security = securities.data?.securities.find(s => s.id === securityId); if (!security) throw new Error('Select a security.');
    const input = transactionCreateSchema.safeParse({ security: { symbol: security.symbol, exchangeMic: security.exchangeMic, currency: security.currency }, side, quantity: amount, price, fees, occurredAt: new Date(`${time}Z`).toISOString() });
    if (!input.success) throw new Error('Use positive decimal quantity and price, nonnegative fees (up to 10 decimal places), and a valid UTC date.');
    const body = JSON.stringify(input.data);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    await apiRequest(`/api/portfolios/${portfolioId}/transactions`, transactionResultSchema, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key }, body });
    await Promise.all([cache.invalidateQueries({ queryKey: ['summary', portfolioId] }), cache.invalidateQueries({ queryKey: ['transactions', portfolioId] })]); close();
  }); }}><fieldset disabled={submit.busy}><SecuritySelect value={securityId} setValue={setSecurityId} /><label>Side<select value={side} onChange={e => setSide(e.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label><label>Quantity<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><label>Price (USD)<input required inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label><label>Fees (USD)<input required inputMode="decimal" value={fees} onChange={e => setFees(e.target.value)} /></label><label>Executed at (UTC)<input type="datetime-local" step="1" required value={time} onChange={e => setTime(e.target.value)} /></label><button type="submit">{submit.busy ? 'Recording…' : 'Record trade'}</button></fieldset></form>{submit.error && <Problem error={submit.error} />}</Modal>;
}
function Summary({ data }: { data: PortfolioSummary }) {
  const cards = [['Market value', data.marketValue], ['Remaining cost basis', data.remainingCostBasis], ['Realized gain / loss', data.realizedGainLoss], ['Unrealized gain / loss', data.unrealizedGainLoss]] as const;
  return <><p>Calculated {dateTime(data.asOf)} · {data.currency}</p><div className="summary-row">{cards.map(([label, value]) => <div className="mini-stat" key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div>{!data.valuationComplete && <p role="status">Valuation unavailable: an open position has a stale, missing, or invalid quote.</p>}<section className="card"><h2>Holdings</h2>{!data.positions.length ? <p>No holdings yet. Record a purchase to begin.</p> : <div className="table-scroll"><table><caption className="sr-only">Portfolio holdings</caption><thead><tr>{['Security', 'Quantity', 'Average cost', 'Cost basis', 'Quote', 'Market value', 'Realized gain / loss', 'Unrealized gain / loss', 'Allocation'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{data.positions.map(p => <tr key={p.securityId}><th scope="row">{p.security.symbol} · {p.security.exchangeMic}<small> {p.security.currency}{/^0(?:\.0+)?$/.test(p.remainingQuantity) ? ' · Sold out' : ''}</small></th><td title={p.remainingQuantity}>{quantity(p.remainingQuantity)}</td><td title={p.weightedAverageAcquisitionCost ?? undefined}>{p.weightedAverageAcquisitionCost === null ? '—' : money(p.weightedAverageAcquisitionCost)}</td><td>{money(p.remainingCostBasis)}</td><td>{p.quote ? <>{p.quoteStatus === 'invalid' ? 'Unavailable' : money(p.quote.price)}<small className="quote-note">{dateTime(p.quote.asOf)} · {p.quote.provider}{p.quote.isSynthetic ? ' · Synthetic demo' : ''}</small></> : '—'}<small className="quote-note">{p.quoteStatus === 'not_required' ? 'Quote not required' : p.quoteStatus}</small></td><td>{money(p.marketValue)}</td><td>{money(p.realizedGainLoss)}</td><td>{money(p.unrealizedGainLoss)}</td><td>{percent(p.allocationWeight)}</td></tr>)}</tbody></table></div>}</section><section className="card allocation"><h2>Allocation by market value</h2>{data.positions.some(p => p.allocationWeight !== null) ? data.positions.filter(p => p.allocationWeight !== null).map(p => <div key={p.securityId}><span>{p.security.symbol} · {p.security.exchangeMic}: {percent(p.allocationWeight)}</span><div className="allocation-track" role="img" aria-label={`${p.security.symbol}: ${percent(p.allocationWeight)}`}><div style={{ width: percent(p.allocationWeight) }} /></div></div>) : <p>Allocation is unavailable until all open positions have fresh quotes and positive market value.</p>}</section></>;
}
function History({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['transactions', id, offset], queryFn: ({ signal }) => apiRequest(`/api/portfolios/${id}/transactions?limit=10&offset=${offset}`, transactionHistorySchema, { signal }) });
  return <section className="card"><h2>Transaction history</h2>{query.isPending && <p role="status">Loading transactions…</p>}{query.error && <Problem error={query.error} retry={() => void query.refetch()} />}{query.data && <>{!query.data.transactions.length ? <p>No transactions on this page.</p> : <div className="table-scroll"><table><caption className="sr-only">Transactions</caption><thead><tr>{['Executed (UTC)', 'Security', 'Side', 'Quantity', 'Price', 'Fees', 'Net amount'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{query.data.transactions.map(t => <tr key={t.id}><td>{dateTime(t.occurredAt)}</td><th scope="row">{t.security.symbol} · {t.security.exchangeMic}</th><td>{t.side}</td><td>{quantity(t.quantity)}</td><td title={t.price}>{money(t.price)}</td><td title={t.fees}>{money(t.fees)}</td><td>{money(t.amount)}</td></tr>)}</tbody></table></div>}<div className="actions"><button disabled={!offset || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 10))}>Previous page</button><span>Page {offset / 10 + 1}</span><button disabled={query.data.nextOffset === null || query.isFetching} onClick={() => setOffset(query.data!.nextOffset!)}>Next page</button></div></>}</section>;
}
export function PortfolioPage({ selected, select, overview = false }: { selected: string; select: (id: string) => void; overview?: boolean }) {
  const list = usePortfolios(); const portfolio = list.data?.portfolios.find(p => p.id === selected);
  const [dialog, setDialog] = useState<'create' | 'edit' | 'archive' | 'trade' | null>(null);
  const summary = useQuery({ queryKey: ['summary', selected], enabled: !!portfolio, queryFn: ({ signal }) => apiRequest(`/api/portfolios/${selected}/summary`, portfolioSummaryResultSchema, { signal }), refetchInterval: 60000 });
  return <><div className="page-title"><h1>{overview ? 'Portfolio overview' : 'Your portfolios'}</h1><p>Persisted account data · Server-calculated metrics · USD stocks</p></div><div className="actions"><button onClick={() => setDialog('create')}>Create portfolio</button>{portfolio && <><button disabled={!!portfolio.archivedAt} onClick={() => setDialog('edit')}>Edit portfolio</button><button disabled={!!portfolio.archivedAt} onClick={() => setDialog('archive')}>Archive portfolio</button><button disabled={!!portfolio.archivedAt} onClick={() => setDialog('trade')}>Record transaction</button></>}</div>{list.isPending && <p role="status">Loading portfolios…</p>}{list.error && <Problem error={list.error} retry={() => void list.refetch()} />}{list.data && !list.data.portfolios.length && <p>No portfolios yet. Create your first portfolio.</p>}{portfolio && <><h2>{portfolio.name}{portfolio.archivedAt ? ' · Archived (read-only)' : ''}</h2>{summary.isPending && <p role="status">Loading valuation…</p>}{summary.error && <Problem error={summary.error} retry={() => void summary.refetch()} />}{summary.data && <Summary data={summary.data.summary} />}<History key={selected} id={selected} /></>}{dialog === 'trade' && portfolio && <TradeDialog portfolioId={portfolio.id} close={() => setDialog(null)} />}{dialog && dialog !== 'trade' && <PortfolioDialog kind={dialog} {...(portfolio ? { portfolio } : {})} created={select} close={() => setDialog(null)} />}</>;
}
export function WatchlistPage() {
  const query = useQuery({ queryKey: ['watchlist'], queryFn: ({ signal }) => apiRequest('/api/watchlist', watchlistListSchema, { signal }) });
  const [dialog, setDialog] = useState<{ kind: 'add' | 'edit' | 'remove'; id?: string; label?: string } | null>(null); const [securityId, setSecurityId] = useState(''); const submit = useSubmit(); const cache = useQueryClient();
  const close = () => setDialog(null);
  return <><div className="page-title"><h1>Watchlist</h1><p>Your saved USD stocks, identified by exchange.</p></div><button onClick={() => { setSecurityId(''); setDialog({ kind: 'add' }); }}>Add watchlist item</button>{query.isPending && <p role="status">Loading watchlist…</p>}{query.error && <Problem error={query.error} retry={() => void query.refetch()} />}{query.data && <section className="card">{!query.data.entries.length && <p>Your watchlist is empty.</p>}{query.data.entries.map(entry => <div className="watch-row" key={entry.id}><span>{entry.security.symbol} · {entry.security.exchangeMic} · {entry.security.currency} · {entry.security.name}</span><div className="actions"><button onClick={() => { setSecurityId(entry.security.id); setDialog({ kind: 'edit', id: entry.id }); }}>Edit {entry.security.symbol}</button><button onClick={() => setDialog({ kind: 'remove', id: entry.id, label: `${entry.security.symbol} · ${entry.security.exchangeMic}` })}>Remove {entry.security.symbol}</button></div></div>)}</section>}{dialog && <Modal title={dialog.kind === 'remove' ? 'Remove watchlist item' : dialog.kind === 'edit' ? 'Edit watchlist item' : 'Add watchlist item'} close={close} busy={submit.busy}><form onSubmit={event => { event.preventDefault(); void submit.run(async () => {
    const path = dialog.kind === 'add' ? '/api/watchlist' : `/api/watchlist/${dialog.id}` as const;
    const options = { method: dialog.kind === 'add' ? 'POST' : dialog.kind === 'edit' ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json' }, ...(dialog.kind === 'remove' ? {} : { body: JSON.stringify({ securityId }) }) };
    if (dialog.kind === 'remove') await apiRequest(path, watchlistRemovalSchema, options); else await apiRequest(path, watchlistResultSchema, options);
    await cache.invalidateQueries({ queryKey: ['watchlist'] }); close();
  }); }}><fieldset disabled={submit.busy}>{dialog.kind === 'remove' ? <p>Remove {dialog.label} from your watchlist?</p> : <SecuritySelect value={securityId} setValue={setSecurityId} />}<button type="submit">{submit.busy ? 'Saving…' : dialog.kind === 'remove' ? 'Confirm removal' : 'Save watchlist item'}</button></fieldset></form>{submit.error && <Problem error={submit.error} />}</Modal>}</>;
}

