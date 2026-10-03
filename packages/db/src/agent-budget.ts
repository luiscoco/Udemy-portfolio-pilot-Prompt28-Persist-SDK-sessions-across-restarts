import type { Prisma } from './generated/prisma/client.js';
import { PortfolioError } from './portfolio-service.js';

export interface BudgetReservation { reserveUsd: string; dailyUsd: string }
const money = (value: string) => /^\d+(\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
/** Same transaction as run creation. ON CONFLICT locks the UTC-day row across API replicas. */
export async function reserveAgentBudget(tx: Prisma.TransactionClient, ownerId: string, budget: BudgetReservation) {
  if (!money(budget.reserveUsd) || !money(budget.dailyUsd)) throw new PortfolioError(400, 'Invalid budget configuration.');
  // Database time is authoritative so all replicas agree about the UTC boundary.
  const rows = await tx.$queryRaw<Array<{ day: string }>>`
    INSERT INTO "DailyAgentBudget" ("ownerId", "day", "reservedUsd", "chargedUsd")
    SELECT ${ownerId}, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD'), ${budget.reserveUsd}::numeric, 0
    WHERE ${budget.reserveUsd}::numeric <= ${budget.dailyUsd}::numeric
    ON CONFLICT ("ownerId", "day") DO UPDATE
      SET "reservedUsd" = "DailyAgentBudget"."reservedUsd" + EXCLUDED."reservedUsd"
      WHERE "DailyAgentBudget"."reservedUsd" + "DailyAgentBudget"."chargedUsd" + EXCLUDED."reservedUsd" <= ${budget.dailyUsd}::numeric
    RETURNING "day"`;
  if (!rows[0]) throw new PortfolioError(429, 'Your daily assistant budget is fully used or reserved by active answers. Wait for an answer to finish, or try again after midnight UTC.');
  return rows[0].day;
}
