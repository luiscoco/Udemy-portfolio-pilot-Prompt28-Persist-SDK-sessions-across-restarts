import { createHash, randomUUID } from 'node:crypto';
import { APP_EVENT_SCHEMA_VERSION, appEventSchema, type AppEvent } from '@portfolio-pilot/contracts';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';

type Tx = Prisma.TransactionClient;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewAppEvent = DistributiveOmit<AppEvent, 'id' | 'schemaVersion' | 'occurredAt'> & { id?: string; occurredAt?: Date };

/** Dispatcher defaults; documented in ADR 0007. */
export const OUTBOX_POLICY = { batchSize: 50, leaseMs: 30000, maxAttempts: 8, publishedRetentionMs: 7 * 24 * 3600000 } as const;

// RFC 9562 name-based UUIDv5: the same (source event, owner) always produces the same event ID.
const FAN_OUT_NAMESPACE = Buffer.from('6f1d3c52a8e94b7c9d0e2f4a5b6c7d8e', 'hex');
export function uuidV5(name: string, namespace = FAN_OUT_NAMESPACE): string {
  const bytes = createHash('sha1').update(namespace).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildEvent(input: NewAppEvent, now = new Date()): AppEvent {
  const { id, occurredAt, ...rest } = input;
  return appEventSchema.parse({ ...rest, id: id ?? randomUUID(), schemaVersion: APP_EVENT_SCHEMA_VERSION, occurredAt: (occurredAt ?? now).toISOString() });
}
function toRow(event: AppEvent) {
  return {
    id: event.id, type: event.type, schemaVersion: event.schemaVersion, occurredAt: new Date(event.occurredAt),
    audience: event.audience.kind, ownerId: event.audience.kind === 'user' ? event.audience.userId : null,
    portfolioId: event.portfolioId, entityType: event.entityType, entityId: event.entityId,
    payload: event.payload as unknown as Prisma.InputJsonValue
  };
}

/**
 * Must be called with the transaction client of the domain change. If that transaction rolls back,
 * the event never existed; if it commits, the event is durable even when Redis is down.
 */
export async function appendEvent(tx: Tx, input: NewAppEvent): Promise<AppEvent> {
  const event = buildEvent(input);
  await tx.outboxEvent.create({ data: toRow(event) });
  return event;
}

interface OutboxRow {
  id: string; claimToken: string; attempts: number; sequence: bigint; type: string; schemaVersion: number; occurredAt: Date;
  audience: string; ownerId: string | null; portfolioId: string | null; entityType: string; entityId: string; payload: unknown;
}
export interface ClaimedEvent { id: string; claimToken: string; attempts: number; sequence: bigint; event: AppEvent | null; invalidReason: string | null }
function toClaim(row: OutboxRow): ClaimedEvent {
  const audience = row.audience === 'user' ? { kind: 'user', userId: row.ownerId } : { kind: row.audience };
  const parsed = appEventSchema.safeParse({ id: row.id, type: row.type, schemaVersion: row.schemaVersion, occurredAt: row.occurredAt.toISOString(), audience,
    portfolioId: row.portfolioId, entityType: row.entityType, entityId: row.entityId, payload: row.payload });
  return { id: row.id, claimToken: row.claimToken, attempts: row.attempts, sequence: row.sequence, event: parsed.success ? parsed.data : null,
    invalidReason: parsed.success ? null : `Unsupported or invalid ${row.type} v${row.schemaVersion} envelope` };
}

export function outboxRepository(db: PrismaClient) {
  return {
    /**
     * Durable claim: rows stay in PostgreSQL; a lease and fresh claim token are stamped atomically.
     * SKIP LOCKED lets dispatcher replicas claim disjoint batches. Attempts count at claim time, so
     * an event that crashes the process still exhausts its bounded retry budget.
     */
    async claim(owner: string, options: { limit?: number; leaseMs?: number; maxAttempts?: number } = {}): Promise<ClaimedEvent[]> {
      const limit = options.limit ?? OUTBOX_POLICY.batchSize, leaseMs = options.leaseMs ?? OUTBOX_POLICY.leaseMs, max = options.maxAttempts ?? OUTBOX_POLICY.maxAttempts;
      await db.$executeRaw`UPDATE "OutboxEvent" SET "status"='DEAD', "lastError"='Retry budget exhausted by expired leases', "leaseOwner"=NULL, "leaseUntil"=NULL, "claimToken"=NULL
        WHERE "status"='PENDING' AND "attempts">=${max} AND ("leaseUntil" IS NULL OR "leaseUntil"<=clock_timestamp())`;
      const rows = await db.$queryRaw<OutboxRow[]>`UPDATE "OutboxEvent" o SET "leaseOwner"=${owner}, "leaseUntil"=clock_timestamp()+${leaseMs} * interval '1 millisecond',
          "claimToken"=gen_random_uuid(), "attempts"=o."attempts"+1
        FROM (SELECT "id" FROM "OutboxEvent" WHERE "status"='PENDING' AND "attempts"<${max} AND "availableAt"<=clock_timestamp()
              AND ("leaseUntil" IS NULL OR "leaseUntil"<=clock_timestamp()) ORDER BY "sequence" LIMIT ${limit} FOR UPDATE SKIP LOCKED) c
        WHERE o."id"=c."id"
        RETURNING o."id"::text AS "id", o."claimToken"::text AS "claimToken", o."attempts", o."sequence", o."type", o."schemaVersion", o."occurredAt",
          o."audience", o."ownerId", o."portfolioId", o."entityType", o."entityId", o."payload"`;
      return rows.sort((a, b) => (a.sequence < b.sequence ? -1 : 1)).map(toClaim);
    },
    /** Fenced acknowledgement. False means another dispatcher re-claimed it: a duplicate publish is possible and expected. */
    async markPublished(claim: ClaimedEvent, delivery: { streamKey: string; entryId: string }): Promise<boolean> {
      return 1 === await db.$executeRaw`UPDATE "OutboxEvent" SET "status"='PUBLISHED', "publishedAt"=clock_timestamp(), "streamKey"=${delivery.streamKey}, "streamEntryId"=${delivery.entryId},
          "leaseOwner"=NULL, "leaseUntil"=NULL, "claimToken"=NULL, "lastError"=NULL
        WHERE "id"=${claim.id}::uuid AND "claimToken"=${claim.claimToken}::uuid AND "status"='PENDING'`;
    },
    /** Bounded retry: reschedule with the caller's backoff, or park as DEAD once the budget is spent. */
    async markFailed(claim: ClaimedEvent, error: string, delayMs: number, maxAttempts: number = OUTBOX_POLICY.maxAttempts): Promise<'retry' | 'dead' | 'lost'> {
      const rows = await db.$queryRaw<{ status: string }[]>`UPDATE "OutboxEvent" SET
          "status"=CASE WHEN "attempts">=${maxAttempts} THEN 'DEAD'::"OutboxStatus" ELSE 'PENDING'::"OutboxStatus" END,
          "availableAt"=clock_timestamp()+${Math.max(0, Math.round(delayMs))} * interval '1 millisecond', "lastError"=left(${error}, 500),
          "leaseOwner"=NULL, "leaseUntil"=NULL, "claimToken"=NULL
        WHERE "id"=${claim.id}::uuid AND "claimToken"=${claim.claimToken}::uuid AND "status"='PENDING' RETURNING "status"::text AS "status"`;
      return !rows[0] ? 'lost' : rows[0].status === 'DEAD' ? 'dead' : 'retry';
    },
    /**
     * Idempotent consumer for internal `news.article.ingested` events: ingestion stays global, and
     * this creates one owner-scoped `news.available` per interested user. Deterministic UUIDs plus
     * ON CONFLICT DO NOTHING make redelivery harmless; the source row is acknowledged in the same
     * transaction as the notifications it produced.
     */
    async fanOutNews(claim: ClaimedEvent): Promise<number> {
      const event = claim.event;
      if (event?.type !== 'news.article.ingested') throw new Error('NOT_A_FAN_OUT_EVENT');
      return db.$transaction(async tx => {
        const held = await tx.$queryRaw<{ id: string }[]>`SELECT "id"::text AS "id" FROM "OutboxEvent" WHERE "id"=${claim.id}::uuid AND "claimToken"=${claim.claimToken}::uuid AND "status"='PENDING' FOR UPDATE`;
        if (!held.length) throw new Error('LEASE_LOST');
        const securityIds = event.payload.securityIds;
        const article = await tx.newsArticle.findUnique({ where: { id: event.entityId }, select: { id: true } });
        const interests = new Map<string, { securityIds: Set<string>; portfolioIds: Set<string>; watchlisted: boolean }>();
        const interest = (ownerId: string) => interests.get(ownerId) ?? interests.set(ownerId, { securityIds: new Set(), portfolioIds: new Set(), watchlisted: false }).get(ownerId)!;
        // A merged-away article has no current row; nothing is announced for it.
        if (article && securityIds.length) {
          // Current open positions only, in active portfolios; each owner sees only their own portfolio IDs.
          const holdings = await tx.$queryRaw<{ ownerId: string; portfolioId: string; securityId: string }[]>`
            SELECT p."ownerId", p."id" AS "portfolioId", t."securityId" FROM "PortfolioTransaction" t JOIN "Portfolio" p ON p."id"=t."portfolioId"
            WHERE t."securityId" IN (${Prisma.join(securityIds)}) AND p."archivedAt" IS NULL
            GROUP BY p."ownerId", p."id", t."securityId" HAVING SUM(CASE WHEN t."side"='BUY' THEN t."quantity" ELSE -t."quantity" END) > 0`;
          for (const row of holdings) { const entry = interest(row.ownerId); entry.securityIds.add(row.securityId); entry.portfolioIds.add(row.portfolioId); }
          for (const row of await tx.watchlistEntry.findMany({ where: { securityId: { in: securityIds } }, select: { ownerId: true, securityId: true } })) {
            const entry = interest(row.ownerId); entry.securityIds.add(row.securityId); entry.watchlisted = true;
          }
        }
        const notifications = [...interests].sort(([a], [b]) => a.localeCompare(b)).map(([ownerId, entry]) => toRow(buildEvent({
          id: uuidV5(`${event.id}:${ownerId}`), type: 'news.available', audience: { kind: 'user', userId: ownerId }, entityType: 'news_article', entityId: event.entityId, portfolioId: null,
          payload: { change: event.payload.change, securityIds: [...entry.securityIds].sort(), portfolioIds: [...entry.portfolioIds].sort(), watchlisted: entry.watchlisted, sourceEventId: event.id }
        })));
        const created = notifications.length ? (await tx.outboxEvent.createMany({ data: notifications, skipDuplicates: true })).count : 0;
        await tx.$executeRaw`UPDATE "OutboxEvent" SET "status"='PUBLISHED', "publishedAt"=clock_timestamp(), "streamKey"='local:news-fan-out', "streamEntryId"=NULL,
          "leaseOwner"=NULL, "leaseUntil"=NULL, "claimToken"=NULL, "lastError"=NULL WHERE "id"=${claim.id}::uuid`;
        return created;
      }, { timeout: 15000 });
    },
    /** PostgreSQL retention: published rows are audit/diagnostic history only; DEAD rows wait for an operator. */
    async purgePublished(olderThanMs: number = OUTBOX_POLICY.publishedRetentionMs, limit = 1000): Promise<number> {
      return db.$executeRaw`DELETE FROM "OutboxEvent" WHERE "id" IN (SELECT "id" FROM "OutboxEvent" WHERE "status"='PUBLISHED'
        AND "publishedAt" < clock_timestamp() - ${olderThanMs} * interval '1 millisecond' ORDER BY "sequence" LIMIT ${limit})`;
    },
    /** Operator action after fixing the cause of a DEAD event; it keeps its UUID, so consumers still dedupe. */
    async requeueDead(id: string): Promise<boolean> {
      return 1 === await db.$executeRaw`UPDATE "OutboxEvent" SET "status"='PENDING', "attempts"=0, "availableAt"=clock_timestamp(), "lastError"=NULL WHERE "id"=${id}::uuid AND "status"='DEAD'`;
    }
  };
}
export type OutboxRepository = ReturnType<typeof outboxRepository>;
