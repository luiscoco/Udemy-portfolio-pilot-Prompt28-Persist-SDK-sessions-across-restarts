ALTER TABLE "AgentRun" ALTER COLUMN "status" TYPE VARCHAR(32);
DROP INDEX "AgentRun_one_running_per_conversation";
CREATE UNIQUE INDEX "AgentRun_one_running_per_conversation" ON "AgentRun"("conversationId") WHERE "status" IN ('running', 'waiting_for_approval');
CREATE TABLE "ApprovalRequest" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "runId" TEXT NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE,
 "actionType" VARCHAR(32) NOT NULL, "arguments" JSONB NOT NULL, "argumentHash" CHAR(64) NOT NULL,
 "before" JSONB NOT NULL, "mutationId" TEXT NOT NULL UNIQUE, "status" VARCHAR(16) NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "consumedAt" TIMESTAMPTZ(3),
 CONSTRAINT "ApprovalRequest_status_check" CHECK ("status" IN ('pending','approved','consumed','rejected','expired','cancelled','invalidated'))
);
CREATE INDEX "ApprovalRequest_ownerId_runId_createdAt_idx" ON "ApprovalRequest"("ownerId", "runId", "createdAt");
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_status_check";
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_status_check" CHECK ("status" IN ('running','waiting_for_approval','completed','failed','cancelled'));
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_terminal_check";
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_terminal_check" CHECK (("status" IN ('running','waiting_for_approval')) = ("completedAt" IS NULL));
