import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StreamingProvider } from './streaming';

type Identity = { user: { id: string; name: string; email: string }; expiresAt: string };
async function authRequest(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to continue.' : 'Authentication unavailable. Check the API configuration and demo seed.');
  return response.json();
}
export function AuthenticationGate({ children }: { children: React.ReactNode }) {
  const cache = useQueryClient();
  const generation = useRef(0);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState({ demo: false, microsoft: false });
  const reload = async () => {
    const current = generation.current;
    try { const result = await authRequest('/api/me'); if (current === generation.current) setIdentity(previous => {
      if (previous && previous.user.id !== result.user.id) cache.clear();
      return result;
    }); }
    catch { if (current === generation.current) { setIdentity(null); cache.clear(); } }
    finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => {
    void reload();
    void authRequest('/api/auth/options').then(setOptions).catch(() => setError('Authentication service unavailable.'));
    return () => { generation.current++; };
  }, []);
  useEffect(() => {
    const expire = () => { generation.current++; setIdentity(null); cache.clear(); setError('Your session expired. Sign in to continue.'); };
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, [cache]);
  useEffect(() => {
    if (!identity) return;
    const timer = window.setTimeout(() => { generation.current++; setIdentity(null); cache.clear(); }, Math.min(2147483647, Math.max(0, Date.parse(identity.expiresAt) - Date.now())));
    const refresh = () => { void reload(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearTimeout(timer); clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [identity]);
  async function signIn(account: 'alice' | 'bob' | 'microsoft') {
    generation.current++; setBusy(true); setError(''); cache.clear();
    try {
      if (account === 'microsoft') {
        const result = await authRequest('/api/auth/sign-in/social', { provider: 'microsoft', callbackURL: '/' });
        if (result.url) window.location.assign(result.url);
      } else {
        await authRequest('/api/auth/demo-sign-in', { account }); await reload();
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (loading) return <main><p role="status">Checking session…</p></main>;
  if (!identity) return <main className="page-title"><h1>Sign in to PortfolioPilot</h1><p>Manage your own persisted portfolios and watchlist.</p>{options.demo && <><p>Local demo authentication — no password required.</p><button disabled={busy} onClick={() => void signIn('alice')}>Sign in as Alice Demo</button><button disabled={busy} onClick={() => void signIn('bob')}>Sign in as Bob Demo</button></>}{options.microsoft && <button disabled={busy} onClick={() => void signIn('microsoft')}>Sign in with Microsoft</button>}{error && <p role="alert">{error}</p>}</main>;
  return <><div role="region" aria-label="Authenticated session" style={{ padding: '0.5rem 1rem' }}>{identity.user.name} · Session expires {new Date(identity.expiresAt).toLocaleTimeString()} <button disabled={busy} onClick={() => {
    setBusy(true); void authRequest('/api/auth/sign-out', {}).then(() => { generation.current++; setIdentity(null); cache.clear(); }).catch(e => setError(e.message)).finally(() => setBusy(false));
  }}>Sign out</button>{error && <span role="alert">{error}</span>}</div><StreamingProvider key={identity.user.id} userId={identity.user.id}>{children}</StreamingProvider></>;
}
