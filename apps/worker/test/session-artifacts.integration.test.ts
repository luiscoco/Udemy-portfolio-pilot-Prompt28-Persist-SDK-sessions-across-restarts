import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticateOwner, agentJobs, chatService, closeConnections, getDatabase, ownerForAgentRun, type RunOutcome } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/src/seed.js';
import { LocalSessionArtifactStore } from '@portfolio-pilot/agent';
const url = process.env.SESSION_ARTIFACT_TEST_DATABASE_URL;
describe.skipIf(!url)('completed-turn persistence across actual worker processes (PostgreSQL/mock agent)', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>, root: string;
  let chat: ReturnType<typeof chatService>;
  const conversations: string[] = [];
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/portfolio_m28_verify') throw new Error('Use the isolated loopback portfolio_m28_verify database');
    db = await getDatabase(url!); await seedDemo(db, { now: () => new Date() });
    await db.session.upsert({ where: { token: 'm28-alice' }, create: { id: 'm28-alice', token: 'm28-alice', userId: 'demo-alice', expiresAt: new Date(Date.now() + 3600000) }, update: { expiresAt: new Date(Date.now() + 3600000) } });
    chat = chatService(db, await authenticateOwner(db, 'm28-alice'));
    root = await mkdtemp(join(tmpdir(), 'm28-workers-'));
  });
  afterAll(async () => {
    if (db) { await db.conversation.deleteMany({ where: { id: { in: conversations } } }); await db.session.deleteMany({ where: { id: 'm28-alice' } }); }
    if (root) await rm(root, { recursive: true, force: true }); await closeConnections();
  });
  async function createConversation() { const c = await chat.create({ portfolioId: 'demo-growth' }); conversations.push(c.id); return c; }
  const submit = (id: string, content: string) => chat.startRun(id, { runId: randomUUID(), assistantMessageId: randomUUID(), content });
  async function launch(workspace: string) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], {
      env: { ...process.env, DATABASE_URL: url!, DATA_MODE: 'mock', AGENT_MODE: 'mock', WORKER_ROLE: 'agent', WORKER_ONCE: 'true',
        SESSION_ARTIFACT_BACKEND: 'local', SESSION_ARTIFACT_DIR: join(root, 'persistent'), AGENT_WORKSPACE_DIR: workspace, AGENT_MOCK_STREAM_DELAY_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = ''; child.stdout.on('data', bytes => output += String(bytes)); child.stderr.on('data', bytes => output += String(bytes));
    const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    expect(code, output).toBe(0); expect(output).not.toContain('unavailable or interrupted');
  }
  async function answer(id: string) { return (await chat.messages(id, {})).messages.at(-1)!; }
  it('completes, exits, restarts with an empty workspace, restores private memory and answers an article follow-up', async () => {
    const c = await createConversation(); await submit(c.id, 'Which recent news affects my largest holding?');
    const firstWorkspace = join(root, 'first'); await launch(firstWorkspace);
    const first = await answer(c.id); expect(first.status).toBe('completed'); expect(first.sources.length).toBeGreaterThan(0);
    const binding = (await chat.sessionBinding(c.id))!; expect(binding.artifact).toBeDefined();
    await expect(db.conversationSession.update({ where: { conversationId: c.id }, data: { artifactSha256: null } })).rejects.toThrow();
    const bytes = await readFile(join(root, 'persistent', binding.artifact!.key)); expect(bytes.length).toBeGreaterThan(0);
    expect(await readdir(firstWorkspace)).toEqual([]);
    await rm(firstWorkspace, { recursive: true });
    await submit(c.id, 'Tell me more about that article');
    const secondWorkspace = join(root, 'brand-new-ephemeral'); await launch(secondWorkspace);
    const followup = await answer(c.id);
    expect(followup).toMatchObject({ status: 'completed', continuity: { disposition: 'resumed', reason: null } });
    expect(followup.content).toContain('remembered by this session'); expect(followup.sources[0]?.articleId).toBe(first.sources[0]?.articleId);
    expect((await chat.sessionBinding(c.id))!.generation).toBe(binding.generation + 1); expect(await readdir(secondWorkspace)).toEqual([]);
  }, 30000);
  it.each(['missing', 'corrupt'])('detects %s state, truthfully reseeds, and publishes a replacement only after completion', async damage => {
    const c = await createConversation(); await submit(c.id, 'Which recent news affects my largest holding?'); await launch(join(root, 'damage-start'));
    const binding = (await chat.sessionBinding(c.id))!, path = join(root, 'persistent', binding.artifact!.key);
    if (damage === 'missing') await rm(path); else await writeFile(path, '{}');
    await submit(c.id, 'Tell me more about that article'); await launch(join(root, 'damage-restart'));
    const followup = await answer(c.id); expect(followup).toMatchObject({ status: 'completed', continuity: { disposition: 'reseeded', reason: 'session_missing' } });
    expect(followup.content).toContain('application summary'); expect((await chat.sessionBinding(c.id))!.artifact!.key).not.toBe(binding.artifact!.key);
  }, 30000);
  it('two workers racing to restore one conversation produce one resumed turn and one new checkpoint', async () => {
    const c = await createConversation(); await submit(c.id, 'Which recent news affects my largest holding?'); await launch(join(root, 'race-start'));
    const binding = (await chat.sessionBinding(c.id))!;
    const { run } = await submit(c.id, 'Tell me more about that article');
    await Promise.all([launch(join(root, 'race-a')), launch(join(root, 'race-b'))]);
    expect(await chat.getRun(run.id)).toMatchObject({ status: 'completed', attempt: 1 });
    expect(await answer(c.id)).toMatchObject({ continuity: { disposition: 'resumed' } });
    expect((await chat.sessionBinding(c.id))!.generation).toBe(binding.generation + 1);
    expect(await db.chatMessage.count({ where: { id: run.assistantMessageId } })).toBe(1);
  }, 30000);
  it('expired attempt cannot publish an uploaded checkpoint; failed turns keep the prior valid reference', async () => {
    const c = await createConversation(); await submit(c.id, 'Which recent news affects my largest holding?'); await launch(join(root, 'fence-start'));
    const binding = (await chat.sessionBinding(c.id))!;
    const { run } = await submit(c.id, 'Follow-up'), jobs = agentJobs(db), fence = (await jobs.claim('old-artifact-attempt'))!;
    const workerChat = chatService(db, await ownerForAgentRun(db, fence), fence), store = new LocalSessionArtifactStore(join(root, 'persistent'));
    const snapshot = await store.load({ ownerId: 'demo-alice', conversationId: c.id }, binding.artifact!);
    const orphan = await store.save({ ownerId: 'demo-alice', conversationId: c.id }, snapshot);
    const outcome: RunOutcome = { status: 'completed', failureCode: null, content: 'stale', mode: 'mock', instructionVersion: binding.instructionVersion, sources: [],
      checkpoint: { expectedGeneration: binding.generation, binding: { ...binding, artifact: orphan } } };
    await jobs.heartbeat(fence, true);
    await db.agentRun.update({ where: { id: run.id }, data: { leaseUntil: new Date(0) } });
    await db.conversation.update({ where: { id: c.id }, data: { leaseUntil: new Date(0) } });
    await expect(workerChat.finishRun(run.id, outcome)).rejects.toMatchObject({ status: 409 });
    await jobs.recover(); expect((await chat.sessionBinding(c.id))!.artifact).toEqual(binding.artifact);
    // A later valid worker resumes the last complete checkpoint after the interrupted attempt.
    await submit(c.id, 'Tell me more about that article'); await launch(join(root, 'after-crash'));
    expect(await answer(c.id)).toMatchObject({ status: 'completed', continuity: { disposition: 'resumed' } });
  }, 30000);
  it('generation mismatch rolls back completion and durable cancellation suppresses checkpoint publication', async () => {
    const c = await createConversation(); await submit(c.id, 'Which recent news affects my largest holding?'); await launch(join(root, 'cas-start'));
    const binding = (await chat.sessionBinding(c.id))!, { run } = await submit(c.id, 'New turn'), jobs = agentJobs(db), fence = (await jobs.claim('cas-worker'))!;
    const workerChat = chatService(db, await ownerForAgentRun(db, fence), fence);
    const outcome: RunOutcome = { status: 'completed', failureCode: null, content: 'finished', mode: 'mock', instructionVersion: binding.instructionVersion, sources: [],
      checkpoint: { expectedGeneration: binding.generation - 1, binding: { ...binding, artifact: binding.artifact! } } };
    await expect(workerChat.finishRun(run.id, outcome)).rejects.toMatchObject({ status: 409 });
    expect(await db.chatMessage.count({ where: { id: run.assistantMessageId } })).toBe(0);
    await chat.requestCancel(run.id);
    outcome.checkpoint!.expectedGeneration = binding.generation;
    expect((await workerChat.finishRun(run.id, outcome))!.run.status).toBe('cancelled');
    expect(await chat.sessionBinding(c.id)).toEqual(binding);
  }, 30000);
});
