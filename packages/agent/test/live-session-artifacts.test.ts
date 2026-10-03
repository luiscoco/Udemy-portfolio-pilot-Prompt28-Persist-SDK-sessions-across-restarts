import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LocalSessionArtifactStore, TurnTranscriptStore } from '../src/session-artifacts.js';
import { AzureBlobSessionArtifactStore, workloadIdentityBlobToken } from '../src/azure-session-artifacts.js';

it.skipIf(process.env.RUN_LIVE_BLOB_ARTIFACTS !== 'true')('LIVE Azure Blob: private snapshot round trip and scoped deletion (existing resources only)', async () => {
  const store = new AzureBlobSessionArtifactStore({ containerUrl: process.env.SESSION_BLOB_CONTAINER_URL!,
    accessToken: workloadIdentityBlobToken({ tenantId: process.env.AZURE_TENANT_ID!, clientId: process.env.AZURE_CLIENT_ID!, tokenFile: process.env.AZURE_FEDERATED_TOKEN_FILE! }) });
  const scope = { ownerId: 'live-verification', conversationId: randomUUID() };
  try {
    const ref = await store.save(scope, { mode: 'mock', sessionId: randomUUID(), modelKey: 'live-blob-test', instructionVersion: 'test', transcripts: {}, mockMemory: { turns: 1, articleIds: [] } });
    expect((await store.load(scope, ref)).mockMemory?.turns).toBe(1);
    await store.deleteConversation(scope);
    await expect(store.load(scope, ref)).rejects.toMatchObject({ code: 'missing' });
  } finally { await store.deleteConversation(scope); }
}, 60000);

it.skipIf(process.env.RUN_LIVE_SDK_RESTART !== 'true')('LIVE Claude: resumed private code after deleting the original workspace', async () => {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.AGENT_MODEL_ID) throw new Error('Live test requires ANTHROPIC_API_KEY and AGENT_MODEL_ID');
  const root = await mkdtemp(join(tmpdir(), 'm28-live-')), store = new LocalSessionArtifactStore(join(root, 'persistent'));
  const scope = { ownerId: 'live-verification', conversationId: randomUUID() }, code = 'violet-comet-' + randomUUID();
  async function turn(dir: string, mirror: TurnTranscriptStore, prompt: string, resume?: string) {
    await mkdir(dir); const abortController = new AbortController(), timer = setTimeout(() => abortController.abort(), 45000);
    const runtime = query({ prompt, options: { cwd: dir, settingSources: [], tools: [], mcpServers: {}, strictMcpConfig: true, permissionMode: 'dontAsk',
      model: process.env.AGENT_MODEL_ID!, maxTurns: 1, maxBudgetUsd: 0.05, sessionStore: mirror, sessionStoreFlush: 'eager', persistSession: true,
      abortController, ...(resume ? { resume } : {}), env: { ...getDefaultEnvironment(), ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!, CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } } });
    // Keep only the public result, never emit raw SDK frames.
    let sessionId = '', text = '';
    try { for await (const frame of runtime) {
      if (frame.type === 'system' && frame.subtype === 'mirror_error') throw new Error('Live mirror failed');
      if (frame.type === 'result') { expect(frame.subtype).toBe('success'); sessionId = frame.session_id; if (frame.subtype === 'success') text = frame.result; }
    } } finally { clearTimeout(timer); runtime.close(); }
    expect(sessionId).not.toBe(''); return { sessionId, text };
  }
  try {
    const firstMirror = new TurnTranscriptStore(), first = await turn(join(root, 'first'), firstMirror, `Remember this private code: ${code}. Reply only OK.`);
    const ref = await store.save(scope, { mode: 'claude', sessionId: first.sessionId, modelKey: process.env.AGENT_MODEL_ID!, instructionVersion: 'test', transcripts: firstMirror.export(first.sessionId) });
    await rm(join(root, 'first'), { recursive: true });
    const snapshot = await new LocalSessionArtifactStore(join(root, 'persistent')).load(scope, ref);
    const followup = await turn(join(root, 'restart'), new TurnTranscriptStore(snapshot), 'What private code did I ask you to remember? Reply only with the code.', first.sessionId);
    expect(followup.text).toContain(code);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
