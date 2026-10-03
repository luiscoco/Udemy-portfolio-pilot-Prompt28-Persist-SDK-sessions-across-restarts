import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StreamManager, type NewsNotice } from './lib/stream-manager';
import type { RunsState } from './lib/agent-runs';

const ConnectionContext = createContext<'Live' | 'Reconnecting' | 'Offline'>('Offline');
const NewsNoticeContext = createContext<NewsNotice[]>([]);
const ManagerContext = createContext<StreamManager | null>(null);
export const useNewsNotices = () => useContext(NewsNoticeContext);
export const useConnection = () => useContext(ConnectionContext);
export const useStreamManager = () => useContext(ManagerContext);
const noRuns = () => () => {};
const NO_RUNS: RunsState = {};
const emptyRuns = () => NO_RUNS; // stable snapshot reference for useSyncExternalStore
/** Live draft of one run (application events only), or undefined until its first event arrives. */
export function useAgentRun(runId: string | null) {
  const manager = useContext(ManagerContext);
  const runs = useSyncExternalStore(manager?.agentRuns.subscribe ?? noRuns, manager?.agentRuns.getSnapshot ?? emptyRuns);
  return runId ? runs[runId] : undefined;
}
export function StreamingProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const cache = useQueryClient();
  const [manager] = useState(() => new StreamManager(userId, cache));
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  return <ManagerContext value={manager}><ConnectionContext value={state.connection}><NewsNoticeContext value={state.newsNotices}><ConnectionStatus />{state.ready ? children : <p role="status">Loading authorized snapshot…</p>}</NewsNoticeContext></ConnectionContext></ManagerContext>;
}
export function ConnectionStatus() {
  const state = useContext(ConnectionContext);
  return <span role="status" aria-label="Update connection" className="stream-status">{state} · App updates. Provider polling and delays still apply.</span>;
}
