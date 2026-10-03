import { randomUUID } from 'node:crypto';
import { browserEventSchema, type BrowserEvent } from '@portfolio-pilot/contracts';
import { EventDeduper, type StreamRead, type StreamScope } from '@portfolio-pilot/db';
import { cursorCodec, type Positions } from './event-cursor';
import { publicEvent } from './browser-event';

export const SSE_LIMITS = { pollMs: 500, heartbeatMs: 15000, revalidateMs: 30000, operationMs: 2000,
  bufferBytes: 65536, clients: 256, clientsPerUser: 16, batch: 100 } as const;
export async function bounded<T>(operation: Promise<T>, ms = SSE_LIMITS.operationMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), ms); })]); }
  finally { clearTimeout(timer); }
}
type Client = { owner: string; positions: Positions; seen: EventDeduper; send: (frame: string) => boolean; close: () => void };
type Reader = (scope: StreamScope, cursor: string) => Promise<StreamRead>;
export function resetFrame(reason: Extract<BrowserEvent, { type: 'stream.reset' }>['reason']): string {
  const dto = browserEventSchema.parse({ id: randomUUID(), schemaVersion: 1, occurredAt: new Date().toISOString(),
    type: 'stream.reset', reason, recoveryUrl: '/api/events/recovery' });
  return `id:\nevent: stream.reset\ndata: ${JSON.stringify(dto)}\n\n`;
}

/** Independent per-process reads. Identical scope/cursor cohorts share one read and local fan-out.
 * No consumer groups, no BLOCK, no connection per browser. Replaying clients converge on live cohorts.
 */
export class EventHub {
  private clients = new Set<Client>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  constructor(private read: Reader, private codec = cursorCodec()) {}
  get size() { return this.clients.size; }
  subscribe(owner: string, positions: Positions, send: Client['send'], close: Client['close']): () => void {
    if (this.size >= SSE_LIMITS.clients || [...this.clients].filter(c => c.owner === owner).length >= SSE_LIMITS.clientsPerUser) throw new Error('STREAM_CAPACITY');
    const client: Client = { owner, positions: { ...positions }, seen: new EventDeduper(2000), send, close };
    this.clients.add(client);
    this.schedule();
    return () => { this.clients.delete(client); if (!this.size) { clearTimeout(this.timer); this.timer = undefined; } };
  }
  private schedule() {
    if (this.timer || this.running || !this.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, SSE_LIMITS.pollMs);
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const reads = new Map<string, Promise<StreamRead>>();
    try {
      await Promise.all([...this.clients].map(async client => {
        try {
          for (const kind of ['user', 'market'] as const) {
            if (!this.clients.has(client)) return;
            const scope: StreamScope = kind === 'user' ? { kind, userId: client.owner } : { kind };
            const key = JSON.stringify([scope, client.positions[kind]]);
            let result = reads.get(key);
            if (!result) { result = bounded(this.read(scope, client.positions[kind])); reads.set(key, result); }
            const batch = await result;
            if (!this.clients.has(client)) return;
            if (batch.status === 'reset') { client.send(resetFrame(batch.reason)); this.remove(client); return; }
            for (const entry of batch.events) {
              // Re-check the audience even when an adapter/test returns malformed stream data.
              const authorized = kind === 'user' ? entry.event.audience.kind === 'user' && entry.event.audience.userId === client.owner : entry.event.audience.kind === 'market';
              if (!authorized) continue;
              const dto = publicEvent(entry.event);
              if (!dto) { client.send(resetFrame('unavailable')); this.remove(client); return; }
              client.positions[kind] = entry.cursor;
              if (client.seen.has(dto.id)) continue;
              const cursor = this.codec.encode(client.owner, client.positions);
              if (!client.send(`id: ${cursor}\nevent: ${dto.type}\ndata: ${JSON.stringify(dto)}\n\n`)) { this.remove(client); return; }
              client.seen.remember(dto.id);
            }
            // Advance over duplicate/sanitized entries without producing another domain event.
            if (client.positions[kind] !== batch.cursor) client.positions[kind] = batch.cursor;
            if (batch.events.length || batch.skipped) {
              if (!client.send(`id: ${this.codec.encode(client.owner, client.positions)}\ndata: {}\n\n`)) { this.remove(client); return; }
            }
          }
        } catch { if (this.clients.has(client)) { client.send(resetFrame('unavailable')); this.remove(client); } }
      }));
    } finally { this.running = false; this.schedule(); }
  }
  private remove(client: Client) {
    this.clients.delete(client);
    if (!this.size) { clearTimeout(this.timer); this.timer = undefined; }
    client.close();
  }
}
