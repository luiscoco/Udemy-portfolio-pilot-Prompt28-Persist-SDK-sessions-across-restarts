import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LocalSessionArtifactStore, TurnTranscriptStore } from '../src/session-artifacts.js';

describe('installed SDK checkpoint/resume with a local deterministic HTTP model fixture', () => {
  it('restarts the real CLI in a new empty workspace and sends restored assistant context to the model', async () => {
    const remembered = `violet-comet-${randomUUID()}`;
    const requests: unknown[] = [];
    // This is an HTTP protocol fixture, not a live Claude/model evaluation. No paid endpoint or key.
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (!request.url?.startsWith('/v1/messages')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}'); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      const restored = JSON.stringify(body.messages).includes(remembered);
      const text = restored ? `The remembered code is ${remembered}` : `I will remember ${remembered}`;
      const message = { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
      if (!body.stream) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(message)); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (event: string, payload: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      frame('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
      frame('content_block_stop', { type: 'content_block_stop', index: 0 });
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
      frame('message_stop', { type: 'message_stop' }); response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number }, root = await mkdtemp(join(tmpdir(), 'm28-real-sdk-'));
    const store = new LocalSessionArtifactStore(join(root, 'persistent')), scope = { ownerId: 'test-owner', conversationId: 'test-conversation' };
    async function turn(workspace: string, mirror: TurnTranscriptStore, prompt: string, resume?: string) {
      await mkdir(workspace);
      const abortController = new AbortController(), timer = setTimeout(() => abortController.abort(), 20000);
      const frames: SDKMessage[] = [];
      const runtime = query({ prompt, options: { cwd: workspace, settingSources: [], tools: [], mcpServers: {}, strictMcpConfig: true,
        permissionMode: 'dontAsk', maxTurns: 1, maxBudgetUsd: 0.01, persistSession: true, sessionStore: mirror, sessionStoreFlush: 'eager',
        model: 'claude-sonnet-4-6', ...(resume ? { resume } : {}), abortController,
        env: { ...getDefaultEnvironment(), CLAUDE_CONFIG_DIR: workspace, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          ANTHROPIC_API_KEY: 'local-http-fixture-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } } });
      try { for await (const frame of runtime) frames.push(frame); }
      finally { clearTimeout(timer); runtime.close(); }
      const result = frames.findLast(frame => frame.type === 'result');
      expect(result?.subtype).toBe('success'); expect(frames.some(frame => frame.type === 'system' && frame.subtype === 'mirror_error')).toBe(false);
      return result!;
    }
    try {
      const firstMirror = new TurnTranscriptStore(), first = await turn(join(root, 'first'), firstMirror, 'Remember a private code.');
      const ref = await store.save(scope, { mode: 'claude', sessionId: first.session_id, modelKey: 'fixture', instructionVersion: 'fixture', transcripts: firstMirror.export(first.session_id) });
      await rm(join(root, 'first'), { recursive: true });
      // Only the private snapshot is retained; no database messages or first-query objects are supplied.
      const restored = await new LocalSessionArtifactStore(join(root, 'persistent')).load(scope, ref);
      const next = await turn(join(root, 'empty-after-restart'), new TurnTranscriptStore(restored), 'What was the code?', first.session_id);
      expect(next.session_id).toBe(first.session_id);
      expect(next.subtype === 'success' ? next.result : '').toContain(remembered);
      expect(JSON.stringify(requests.at(-1))).toContain(remembered);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
  }, 60000);
});
