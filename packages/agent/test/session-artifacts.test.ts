import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSessionArtifactStore, TurnTranscriptStore, type SnapshotInput } from '../src/session-artifacts.js';
import { AzureBlobSessionArtifactStore, workloadIdentityBlobToken } from '../src/azure-session-artifacts.js';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
const scope = { ownerId: 'owner/../private', conversationId: 'conversation' };
const sessionId = randomUUID();
const input: SnapshotInput = { mode: 'claude', sessionId, modelKey: 'test', instructionVersion: 'test', transcripts: {
  main: [{ type: 'user', uuid: randomUUID(), parentUuid: null, sessionId, message: { role: 'user', content: 'Remember the violet comet' } }],
  'subagents/agent-research': [{ type: 'assistant', uuid: randomUUID(), message: { role: 'assistant', content: [{ type: 'text', text: 'Evidence' }] } }]
} };
const roots: string[] = [];
async function temp() { const root = await mkdtemp(join(tmpdir(), 'm28-store-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('private local completed-turn checkpoints', () => {
  it('round trips opaque main/subagent state on a fresh instance and supports SDK transcript reconstruction', async () => {
    const root = await temp(), store = new LocalSessionArtifactStore(root), ref = await store.save(scope, input);
    expect(ref.key).not.toContain(scope.ownerId);
    const restored = await new LocalSessionArtifactStore(root).load(scope, ref);
    expect(restored.transcripts).toEqual(input.transcripts);
    const mirror = new TurnTranscriptStore(restored);
    expect(await mirror.listSubkeys({ projectKey: 'brand-new-workspace', sessionId })).toEqual(['subagents/agent-research']);
    expect(await mirror.load({ projectKey: 'brand-new-workspace', sessionId })).toEqual(input.transcripts.main);
    const messages = await getSessionMessages(sessionId, { sessionStore: mirror });
    expect(messages[0]?.message).toEqual({ role: 'user', content: 'Remember the violet comet' });
  });
  it('rejects missing, corrupted, cross-owner, forged keys and expired artifacts', async () => {
    const root = await temp(); let time = new Date(); const store = new LocalSessionArtifactStore(root, () => time);
    const ref = await store.save(scope, input);
    await expect(store.load({ ...scope, ownerId: 'foreign' }, ref)).rejects.toMatchObject({ code: 'corrupt' });
    await expect(store.load(scope, { ...ref, key: '../../secret' })).rejects.toMatchObject({ code: 'corrupt' });
    await writeFile(join(root, ref.key), 'invalid');
    await expect(store.load(scope, ref)).rejects.toMatchObject({ code: 'corrupt' });
    await rm(join(root, ref.key));
    await expect(store.load(scope, ref)).rejects.toMatchObject({ code: 'missing' });
    const expired = await store.save(scope, input); time = new Date(Date.parse(expired.expiresAt));
    await expect(store.load(scope, expired)).rejects.toMatchObject({ code: 'missing' });
    expect(await store.prune()).toBe(1);
  });
  it('simultaneous saves/restores preserve immutable versions; scoped deletion leaves other owners intact', async () => {
    const root = await temp(), store = new LocalSessionArtifactStore(root);
    const refs = await Promise.all([store.save(scope, input), store.save(scope, input)]);
    expect(refs[0]!.key).not.toBe(refs[1]!.key);
    const foreign = await store.save({ ...scope, ownerId: 'different' }, input);
    expect(await Promise.all(refs.map(ref => new LocalSessionArtifactStore(root).load(scope, ref)))).toHaveLength(2);
    await store.deleteConversation(scope);
    await expect(store.load(scope, refs[0]!)).rejects.toMatchObject({ code: 'missing' });
    await expect(store.load({ ...scope, ownerId: 'different' }, foreign)).resolves.toMatchObject({ sessionId });
  });
  it('deduplicates mirror retries per transcript while retaining opaque non-UUID metadata in order', async () => {
    const mirror = new TurnTranscriptStore(), key = { projectKey: 'isolated', sessionId };
    await mirror.append(key, input.transcripts.main!); await mirror.append(key, input.transcripts.main!);
    await mirror.append(key, [{ type: 'custom-title', customTitle: 'Example' }, { type: 'custom-title', customTitle: 'Example' }]);
    expect(await mirror.load(key)).toHaveLength(3);
    await expect(mirror.append({ ...key, subpath: '../../evil' }, [])).rejects.toThrow();
  });
});

describe('Azure Blob REST contract (mock storage, no Azure credentials)', () => {
  function fake(publicAccess = false) {
    const blobs = new Map<string, string>(), requests: { method: string; headers: Headers }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const target = new URL(String(url)), method = init!.method!;
      requests.push({ method, headers: new Headers(init?.headers) });
      const key = target.pathname.slice('/private/'.length);
      if (method === 'HEAD') return new Response(null, { status: 200, headers: publicAccess ? { 'x-ms-blob-public-access': 'blob' } : {} });
      if (target.searchParams.get('comp') === 'list') return new Response(`<EnumerationResults><Blobs>${[...blobs.keys()].filter(k => k.startsWith(target.searchParams.get('prefix')!)).map(k => `<Blob><Name>${k}</Name></Blob>`).join('')}</Blobs><NextMarker /></EnumerationResults>`);
      if (method === 'PUT') { if (blobs.has(key)) return new Response(null, { status: 412 }); blobs.set(key, Buffer.from(init!.body as Uint8Array).toString()); return new Response(null, { status: 201 }); }
      if (method === 'DELETE') { blobs.delete(key); return new Response(null, { status: 202 }); }
      return blobs.has(key) ? new Response(blobs.get(key)!) : new Response(null, { status: 404 });
    };
    return { blobs, requests, fetcher };
  }
  it('uses authenticated private conditional writes, integrity validation, deletion and expiry sweep', async () => {
    const fakeBlob = fake(); let time = new Date();
    const store = new AzureBlobSessionArtifactStore({ containerUrl: 'https://example.blob.core.windows.net/private', accessToken: async () => 'server-token', fetch: fakeBlob.fetcher }, () => time);
    const ref = await store.save(scope, input); expect((await store.load(scope, ref)).transcripts).toEqual(input.transcripts);
    const put = fakeBlob.requests.find(r => r.method === 'PUT')!;
    expect(put.headers.get('Authorization')).toBe('Bearer server-token'); expect(put.headers.get('If-None-Match')).toBe('*'); expect(put.headers.get('x-ms-meta-sha256')).toBe(ref.sha256);
    fakeBlob.blobs.set(ref.key, '{}'); await expect(store.load(scope, ref)).rejects.toMatchObject({ code: 'corrupt' });
    await store.deleteConversation(scope); expect(fakeBlob.blobs.size).toBe(0);
    const expired = await store.save(scope, input); time = new Date(expired.expiresAt); expect(await store.prune()).toBe(1);
  });
  it('fails closed for public containers, SAS URLs and missing objects', async () => {
    const publicBlob = fake(true), privateBlob = fake();
    const options = { containerUrl: 'https://example.blob.core.windows.net/private', accessToken: async () => 'token' };
    await expect(new AzureBlobSessionArtifactStore({ ...options, fetch: publicBlob.fetcher }).save(scope, input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(() => new AzureBlobSessionArtifactStore({ ...options, containerUrl: options.containerUrl + '?sig=secret' })).toThrow();
    const store = new AzureBlobSessionArtifactStore({ ...options, fetch: privateBlob.fetcher }), ref = await store.save(scope, input);
    privateBlob.blobs.clear(); await expect(store.load(scope, ref)).rejects.toMatchObject({ code: 'missing' });
  });
  it('exchanges a projected workload token, caches it and sends the storage resource scope', async () => {
    const root = await temp(), tokenFile = join(root, 'assertion'); await writeFile(tokenFile, 'projected-token');
    let calls = 0;
    const accessToken = workloadIdentityBlobToken({ tenantId: randomUUID(), clientId: randomUUID(), tokenFile, fetch: async (_url, init) => {
      calls++; const params = init!.body as URLSearchParams;
      expect(params.get('scope')).toBe('https://storage.azure.com/.default'); expect(params.get('client_assertion')).toBe(await readFile(tokenFile, 'utf8'));
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    } });
    expect(await accessToken()).toBe('access-token'); expect(await accessToken()).toBe('access-token'); expect(calls).toBe(1);
  });
});
