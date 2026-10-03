import { chmod, mkdir, mkdtemp, rm, writeFile, readdir, lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LocalSessionArtifactStore, AzureBlobSessionArtifactStore, workloadIdentityBlobToken, TurnTranscriptStore,
  MockSessionStore, SessionArtifactError, AgentRunFailure, PORTFOLIO_INSTRUCTION_VERSION,
  type ArtifactScope, type SessionArtifactStore, type StreamingAgentService, type SessionSnapshot } from '@portfolio-pilot/agent';
import type { ServerConfig } from '@portfolio-pilot/config/server';
import type { AgentFactory } from './agent-execution.js';
import { defaultAgent } from './agent-execution.js';

/** Abrupt local process death can leave a workspace. Only our marked, >24h-old directories qualify. */
export async function pruneRunWorkspaces(root: string, now = Date.now()) {
  const absolute = resolve(root);
  if (await realpath(root) !== absolute) throw new AgentRunFailure('configuration');
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^turn-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const path = resolve(absolute, entry.name);
    if (relative(absolute, path) !== entry.name) throw new AgentRunFailure('configuration');
    try {
      const marker = join(path, '.portfolio-run-workspace');
      if ((await lstat(marker)).isSymbolicLink()) continue;
      const created = Number(await readFile(marker, 'utf8'));
      if (Number.isFinite(created) && created > 0 && now - created > 86400000) await rm(path, { recursive: true, force: true });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}

export function configuredArtifactStore(config: ServerConfig): SessionArtifactStore {
  if (config.NODE_ENV === 'production' && config.SESSION_ARTIFACT_BACKEND === 'local' && !config.SESSION_ARTIFACT_DIR) throw new Error('Production agent workers require an explicit persistent artifact volume');
  if (config.SESSION_ARTIFACT_BACKEND === 'azure') return new AzureBlobSessionArtifactStore({ containerUrl: config.SESSION_BLOB_CONTAINER_URL!,
    accessToken: workloadIdentityBlobToken({ tenantId: config.AZURE_TENANT_ID!, clientId: config.AZURE_CLIENT_ID!, tokenFile: config.AZURE_FEDERATED_TOKEN_FILE! }) });
  return new LocalSessionArtifactStore(config.SESSION_ARTIFACT_DIR ?? resolve('.local/session-artifacts'));
}

/** Invoked only after the worker claims and heartbeats its PostgreSQL conversation/run lease. */
export function artifactAgentFactory(store: SessionArtifactStore, scope: ArtifactScope, config: ServerConfig): AgentFactory {
  return async (tools, binding) => {
    const root = config.AGENT_WORKSPACE_DIR ?? join(tmpdir(), 'portfolio-pilot-agent-runs');
    const source = resolve(fileURLToPath(import.meta.url), '../../../..');
    const difference = relative(source, resolve(root));
    if (!isAbsolute(root) || difference === '' || (!difference.startsWith('..') && !isAbsolute(difference))) throw new AgentRunFailure('configuration');
    if (config.SESSION_ARTIFACT_DIR) {
      const rel = relative(resolve(root), resolve(config.SESSION_ARTIFACT_DIR));
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new AgentRunFailure('configuration');
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    await pruneRunWorkspaces(root);
    const workspace = await mkdtemp(join(root, 'turn-')); await chmod(workspace, 0o700);
    const cleanup = () => rm(workspace, { recursive: true, force: true });
    try {
      await writeFile(join(workspace, '.portfolio-run-workspace'), String(Date.now()), { mode: 0o600, flag: 'wx' });
      let snapshot: SessionSnapshot | undefined;
      if (binding?.artifact) {
        try {
          const loaded = await store.load(scope, binding.artifact);
          if (loaded.sessionId !== binding.sdkSessionId || loaded.modelKey !== binding.modelKey || loaded.mode !== binding.agentMode || loaded.instructionVersion !== binding.instructionVersion) throw new SessionArtifactError('corrupt');
          snapshot = loaded;
        } catch (error) {
          if (!(error instanceof SessionArtifactError) || error.code === 'unavailable') throw new AgentRunFailure('artifact_restore');
          // Missing/expired/corrupt state produces truthful session_missing continuity and reseeding.
        }
      }
      const transcripts = new TurnTranscriptStore(snapshot), mock = new MockSessionStore();
      if (snapshot?.mode === 'mock' && snapshot.mockMemory) mock.set(snapshot.sessionId, snapshot.mockMemory);
      const agent = defaultAgent(tools, { workspace, transcripts, mock });
      let pending: Promise<unknown> | undefined;
      const wrapper: StreamingAgentService = {
        async sessions() {
          const locator = await agent.sessions();
          return { ...locator, hostKey: 'artifacts:v1', isAvailable: async id => snapshot?.sessionId === id && (snapshot.mode === 'mock' ? mock.has(id) : transcripts.has(id)) };
        },
        stream(input) { const result = agent.stream(input); pending = result; return result; },
        async checkpoint(sessionId) {
          const locator = await agent.sessions();
          const memory = mock.get(sessionId);
          return store.save(scope, { mode: locator.modelKey.startsWith('mock:') ? 'mock' : 'claude', sessionId,
            modelKey: locator.modelKey, instructionVersion: PORTFOLIO_INSTRUCTION_VERSION,
            transcripts: memory ? {} : transcripts.export(sessionId), ...(memory ? { mockMemory: memory } : {}) });
        },
        async cleanup() { if (pending) await pending.catch(() => {}); await cleanup(); }
      };
      return wrapper;
    } catch (error) { await cleanup(); throw error; }
  };
}
