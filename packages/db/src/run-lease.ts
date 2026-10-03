import type { Prisma } from './generated/prisma/client.js';
import { PortfolioError } from './portfolio-service.js';
export type RunFence = { runId: string; owner: string; attempt: number };
/** Caller locks conversation before run. Database time determines validity, never worker clocks. */
export async function assertRunFence(tx: Prisma.TransactionClient, fence: RunFence) {
 const rows = await tx.$queryRaw<{ id: string }[]>`SELECT r."id" FROM "AgentRun" r JOIN "Conversation" c ON c."id"=r."conversationId"
 WHERE r."id"=${fence.runId} AND r."leaseOwner"=${fence.owner} AND r."attempt"=${fence.attempt}
 AND r."leaseUntil">clock_timestamp() AND r."status" IN ('running','waiting_for_approval')
 AND c."leaseRunId"=r."id" AND c."leaseOwner"=${fence.owner} AND c."leaseUntil">clock_timestamp() FOR UPDATE OF r`;
 if (!rows.length) throw new PortfolioError(409, 'Worker attempt no longer owns this run.');
}
