CREATE TABLE "DailyAgentBudget" (
  "ownerId" TEXT NOT NULL,
  "day" VARCHAR(10) NOT NULL,
  "reservedUsd" DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK ("reservedUsd" >= 0),
  "chargedUsd" DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK ("chargedUsd" >= 0),
  PRIMARY KEY ("ownerId", "day"),
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "AgentRun"
  ADD COLUMN "budgetDay" VARCHAR(10),
  ADD COLUMN "reservedUsd" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "chargedUsd" DECIMAL(18,6),
  ADD COLUMN "usage" JSONB,
  ADD COLUMN "actualModel" VARCHAR(128);
ALTER TABLE "ChatMessage" ADD COLUMN "usage" JSONB, ADD COLUMN "actualModel" VARCHAR(128);
