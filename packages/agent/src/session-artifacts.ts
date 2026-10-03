import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, link, rm, lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { SDK_SESSION_ID } from './sessions.js';

export const SESSION_ARTIFACT_LIMIT = 16 * 1024 * 1024;
export const SESSION_RETENTION_DAYS = 30;
export type ArtifactScope = { ownerId: string; conversationId: string };
export type SessionArtifactRef = { key: string; sha256: string; expiresAt: string };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const artifactPrefix = (scope: ArtifactScope) => `sessions/v1/${hash(scope.ownerId)}/${hash(scope.conversationId)}/`;
const entry = z.object({ type: z.string(), uuid: z.string().optional() }).passthrough();
const snapshotSchema = z.object({
  format: z.literal(1), sdkVersion: z.literal('0.3.276'), mode: z.enum(['mock', 'claude']),
  sessionId: z.string().regex(SDK_SESSION_ID), modelKey: z.string(), instructionVersion: z.string(),
  ownerHash: z.string(), conversationHash: z.string(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  transcripts: z.record(z.string().regex(/^(main|subagents\/agent-[a-zA-Z0-9_-]+)$/), z.array(entry)),
  mockMemory: z.object({ turns: z.number().int().nonnegative(), articleIds: z.array(z.string()) }).optional()
});
export type SessionSnapshot = Omit<z.infer<typeof snapshotSchema>, 'transcripts'> & { transcripts: Record<string, SessionStoreEntry[]> };
export type SnapshotInput = Omit<SessionSnapshot, 'format' | 'sdkVersion' | 'ownerHash' | 'conversationHash' | 'createdAt' | 'expiresAt'>;
export class SessionArtifactError extends Error {
  constructor(readonly code: 'missing' | 'corrupt' | 'unavailable') { super(`Session artifacts ${code}`); }
}
/** Server-only. Scope comes from authenticated repositories, never model input. No public URLs. */
export interface SessionArtifactStore {
  save(scope: ArtifactScope, snapshot: SnapshotInput): Promise<SessionArtifactRef>;
  load(scope: ArtifactScope, ref: SessionArtifactRef): Promise<SessionSnapshot>;
  deleteConversation(scope: ArtifactScope): Promise<void>;
  prune(now?: Date): Promise<number>;
}
export abstract class ImmutableSessionArtifactStore implements SessionArtifactStore {
  constructor(protected readonly now: () => Date = () => new Date()) {}
  protected abstract put(key: string, bytes: Buffer, ref: SessionArtifactRef): Promise<void>;
  protected abstract get(key: string): Promise<Buffer>;
  protected abstract keys(prefix: string): AsyncIterable<string>;
  protected abstract remove(key: string): Promise<void>;
  protected checkKey(scope: ArtifactScope, key: string) {
    if (!key.startsWith(artifactPrefix(scope)) || !/^sessions\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/\d{13}-[a-f0-9-]{36}\.json$/.test(key)) throw new SessionArtifactError('corrupt');
  }
  async save(scope: ArtifactScope, input: SnapshotInput) {
    const createdAt = this.now(), expiresAt = new Date(createdAt.getTime() + SESSION_RETENTION_DAYS * 86400000).toISOString();
    const snapshot = snapshotSchema.parse({ ...input, format: 1, sdkVersion: '0.3.276', ownerHash: hash(scope.ownerId), conversationHash: hash(scope.conversationId), createdAt: createdAt.toISOString(), expiresAt });
    if ((snapshot.mode === 'claude' && !snapshot.transcripts.main?.length) || (snapshot.mode === 'mock' && !snapshot.mockMemory)) throw new SessionArtifactError('corrupt');
    const bytes = Buffer.from(JSON.stringify(snapshot));
    if (bytes.length > SESSION_ARTIFACT_LIMIT) throw new SessionArtifactError('corrupt');
    const key = `${artifactPrefix(scope)}${createdAt.getTime()}-${randomUUID()}.json`;
    const ref = { key, sha256: hash(bytes), expiresAt };
    await this.put(key, bytes, ref); return ref;
  }
  async load(scope: ArtifactScope, ref: SessionArtifactRef): Promise<SessionSnapshot> {
    this.checkKey(scope, ref.key);
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw new SessionArtifactError('corrupt');
    if (!Number.isFinite(Date.parse(ref.expiresAt))) throw new SessionArtifactError('corrupt');
    if (Date.parse(ref.expiresAt) <= this.now().getTime()) throw new SessionArtifactError('missing');
    const bytes = await this.get(ref.key);
    if (bytes.length > SESSION_ARTIFACT_LIMIT || hash(bytes) !== ref.sha256) throw new SessionArtifactError('corrupt');
    let snapshot: SessionSnapshot;
    try { snapshot = snapshotSchema.parse(JSON.parse(bytes.toString('utf8'))) as SessionSnapshot; } catch { throw new SessionArtifactError('corrupt'); }
    if (snapshot.ownerHash !== hash(scope.ownerId) || snapshot.conversationHash !== hash(scope.conversationId) || snapshot.expiresAt !== ref.expiresAt || (snapshot.mode === 'claude' && !snapshot.transcripts.main?.length) || (snapshot.mode === 'mock' && !snapshot.mockMemory)) throw new SessionArtifactError('corrupt');
    return snapshot;
  }
  async deleteConversation(scope: ArtifactScope) {
    for await (const key of this.keys(artifactPrefix(scope))) { this.checkKey(scope, key.replace(/\.tmp$/, '')); await this.remove(key); }
  }
  async prune(now = this.now()) {
    let count = 0;
    for await (const key of this.keys('sessions/v1/')) {
      const match = /^sessions\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/(\d{13})-[a-f0-9-]{36}\.json(?:\.tmp)?$/.exec(key);
      if (match && Number(match[1]) + SESSION_RETENTION_DAYS * 86400000 <= now.getTime()) { await this.remove(key); count++; }
    }
    return count;
  }
}
/** Put in a persistent private volume, separate from the disposable run-workspace root. */
export class LocalSessionArtifactStore extends ImmutableSessionArtifactStore {
  private readonly root: string;
  constructor(root: string, now?: () => Date) {
    super(now); if (!isAbsolute(root)) throw new Error('Session store requires an absolute path'); this.root = resolve(root);
  }
  private async path(key: string, create = false) {
    const parts = key.split('/');
    let path = this.root;
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink()) throw new SessionArtifactError('unavailable');
    for (const part of parts.slice(0, -1)) {
      path = join(path, part);
      if (create) await mkdir(path, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
      if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink()) throw new SessionArtifactError('unavailable');
    }
    return join(path, parts.at(-1)!);
  }
  protected async put(key: string, bytes: Buffer) {
    const path = await this.path(key, true), temp = `${path}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try {
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await link(temp, path);
    } finally { await rm(temp, { force: true }); }
    // Flush the directory entry where supported (Windows disallows opening directories).
    if (process.platform !== 'win32') { const dir = await open(join(path, '..'), 'r'); try { await dir.sync(); } finally { await dir.close(); } }
  }
  protected async get(key: string) {
    try { const path = await this.path(key); const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SESSION_ARTIFACT_LIMIT) throw new SessionArtifactError('corrupt'); return await readFile(path); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new SessionArtifactError('missing'); throw e; }
  }
  protected async remove(key: string) { try { await rm(await this.path(key), { force: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  protected async *keys(prefix: string): AsyncIterable<string> {
    const walk = async function* (root: string, rel: string): AsyncIterable<string> {
      let entries; try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      for (const entry of entries) { if (entry.isSymbolicLink()) throw new SessionArtifactError('unavailable'); const key = rel + entry.name; if (entry.isDirectory()) yield* walk(root, key + '/'); else yield key; }
    };
    for await (const key of walk(this.root, 'sessions/v1/')) if (key.startsWith(prefix)) yield key;
  }
}

/** A per-attempt SDK mirror. No in-progress writes reach the durable store. */
export class TurnTranscriptStore implements SessionStore {
  private sessions = new Map<string, Record<string, SessionStoreEntry[]>>();
  constructor(snapshot?: SessionSnapshot) { if (snapshot) this.sessions.set(snapshot.sessionId, structuredClone(snapshot.transcripts)); }
  private subpath(key: SessionKey) {
    if (!SDK_SESSION_ID.test(key.sessionId) || (key.subpath && !/^subagents\/agent-[a-zA-Z0-9_-]+$/.test(key.subpath))) throw new SessionArtifactError('corrupt');
    return key.subpath ?? 'main';
  }
  async append(key: SessionKey, entries: SessionStoreEntry[]) {
    const subpath = this.subpath(key), transcripts = this.sessions.get(key.sessionId) ?? {};
    const current = transcripts[subpath] ?? [], seen = new Set(current.map(e => e.uuid).filter(Boolean));
    for (const e of entries) { if (e.uuid && seen.has(e.uuid)) continue; current.push(structuredClone(e)); if (e.uuid) seen.add(e.uuid); }
    transcripts[subpath] = current; this.sessions.set(key.sessionId, transcripts);
    if (Buffer.byteLength(JSON.stringify(transcripts)) > SESSION_ARTIFACT_LIMIT) throw new SessionArtifactError('corrupt');
  }
  async load(key: SessionKey) { return structuredClone(this.sessions.get(key.sessionId)?.[this.subpath(key)] ?? null); }
  async listSubkeys(key: { sessionId: string; projectKey: string }) { return Object.keys(this.sessions.get(key.sessionId) ?? {}).filter(k => k !== 'main'); }
  has(id: string) { return !!this.sessions.get(id)?.main?.length; }
  export(id: string) { if (!this.has(id)) throw new SessionArtifactError('missing'); return structuredClone(this.sessions.get(id)!); }
}
