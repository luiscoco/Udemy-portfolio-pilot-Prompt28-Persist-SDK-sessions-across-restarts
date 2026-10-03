import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { NEWS_EVENT_CATEGORIES, alertRuleWriteSchema, alertRuleListSchema, alertRuleResultSchema, alertNotificationListSchema, type AlertRule, type AlertRuleWrite } from '@portfolio-pilot/contracts';
import { apiRequest } from './lib/api-client';
import { dateTime } from './lib/format';

import { securityListSchema } from '@portfolio-pilot/contracts';
import { Link } from 'react-router';

const initial: AlertRuleWrite = { name: '', enabled: true, categories: [], securityIds: [], concentrationThreshold: null, relevanceThreshold: null, cooldownSeconds: 300 };

export function AlertCenter() {
  const cache = useQueryClient(); const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<AlertRuleWrite>({ ...initial }); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const rules = useQuery({ queryKey: ['alert-rules'], queryFn: ({ signal }) => apiRequest('/api/alerts/rules', alertRuleListSchema, { signal }) });
  const notifications = useQuery({ queryKey: ['alert-notifications'], queryFn: ({ signal }) => apiRequest('/api/alerts/notifications', alertNotificationListSchema, { signal }) });
  const securities = useQuery({ queryKey: ['securities'], queryFn: ({ signal }) => apiRequest('/api/securities', securityListSchema, { signal }) });
  async function action(operation: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError(null);
    try { await operation(); await Promise.all([cache.invalidateQueries({ queryKey: ['alert-rules'] }), cache.invalidateQueries({ queryKey: ['alert-notifications'] })]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed'); } finally { setBusy(false); }
  }
  function edit(rule: AlertRule) { setEditing(rule.id); setDraft(alertRuleWriteSchema.parse({ name: rule.name, enabled: rule.enabled, categories: rule.categories, securityIds: rule.securityIds, concentrationThreshold: rule.concentrationThreshold, relevanceThreshold: rule.relevanceThreshold, cooldownSeconds: rule.cooldownSeconds })); }
  return <section className="card" aria-label="Configurable alerts"><h2>In-app alerts</h2><p>News is evaluated for your current holdings and watchlist. Filters combine with AND; empty categories or securities mean all relevant news. Thresholds are fractions from 0 to 1 and use the labeled exposure basis. Relevance means the affected fraction of portfolio value; watchlist-only news has no numeric exposure.</p>
    {error && <p role="alert">{error}</p>}{[rules, notifications, securities].map((q, i) => q.error ? <p role="alert" key={i}>{q.error.message}</p> : null)}
    <form className="alert-form" onSubmit={e => { e.preventDefault(); void action(async () => { const data = alertRuleWriteSchema.parse(draft); await apiRequest(editing ? `/api/alerts/rules/${encodeURIComponent(editing)}` : '/api/alerts/rules', alertRuleResultSchema, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); setEditing(null); setDraft({ ...initial }); }); }}>
      <label>Rule name<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled</label>
      <label>News categories<select multiple value={draft.categories} onChange={e => setDraft({ ...draft, categories: Array.from(e.target.selectedOptions, o => o.value) as AlertRuleWrite['categories'] })}>{NEWS_EVENT_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></label>
      <label>Watched securities<select multiple value={draft.securityIds} onChange={e => setDraft({ ...draft, securityIds: Array.from(e.target.selectedOptions, o => o.value) })}>{securities.data?.securities.map(s => <option key={s.id} value={s.id}>{s.symbol} / {s.exchangeMic}</option>)}</select></label><p>Select securities you hold or watch; other selections are rejected.</p>
      <label>Minimum concentration (fraction)<input inputMode="decimal" placeholder="Optional, e.g. 0.2" value={draft.concentrationThreshold ?? ''} onChange={e => setDraft({ ...draft, concentrationThreshold: e.target.value || null })} /></label>
      <label>Minimum relevance (fraction)<input inputMode="decimal" placeholder="Optional, e.g. 0.1" value={draft.relevanceThreshold ?? ''} onChange={e => setDraft({ ...draft, relevanceThreshold: e.target.value || null })} /></label>
      <label>Cooldown seconds<input type="number" min={0} max={86400} required value={draft.cooldownSeconds} onChange={e => setDraft({ ...draft, cooldownSeconds: Number(e.target.value) })} /></label>
      <button disabled={busy}>{editing ? 'Update alert rule' : 'Create alert rule'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft({ ...initial }); }}>Cancel edit</button>}
    </form>
    <h3>Your rules</h3>{rules.data?.rules.length === 0 && <p>No alert rules configured.</p>}{rules.data?.rules.map(r => <article key={r.id}><strong>{r.name}</strong><p>{r.enabled ? 'Enabled' : 'Disabled'} · revision {r.revision} · cooldown {r.cooldownSeconds}s · concentration {r.concentrationThreshold ?? 'any'} · relevance {r.relevanceThreshold ?? 'any'}</p><button disabled={busy} onClick={() => edit(r)}>Edit {r.name}</button> <button disabled={busy} onClick={() => void action(() => apiRequest(`/api/alerts/rules/${r.id}`, z.object({ removed: z.literal(true) }), { method: 'DELETE' }))}>Delete {r.name}</button></article>)}
    <h3>Notification history</h3>{notifications.isPending && <p role="status">Loading alerts…</p>}{notifications.data?.notifications.length === 0 && <p>No relevant news matched your alert rules.</p>}
    {notifications.data?.notifications.map(n => <article key={n.id} aria-label="Alert notification"><strong>{n.title}</strong><p>Rule revision {n.ruleRevision} · <time dateTime={n.createdAt}>{dateTime(n.createdAt)}</time> · {n.dismissedAt ? 'Dismissed' : 'New'} · {n.recommendationIds.length} research actions</p><Link to="/research">Review recommendations</Link> {!n.dismissedAt && <button disabled={busy} onClick={() => void action(() => apiRequest(`/api/alerts/notifications/${n.id}`, z.object({ dismissed: z.literal(true) }), { method: 'PATCH' }))}>Dismiss alert</button>}</article>)}
  </section>;
}


