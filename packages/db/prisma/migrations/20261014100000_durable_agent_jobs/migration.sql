ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_status_check";
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_terminal_check";
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_status_check" CHECK ("status" IN ('queued','running','waiting_for_approval','completed','failed','cancelled'));
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_terminal_check" CHECK (("status" IN ('queued','running','waiting_for_approval')) = ("completedAt" IS NULL));
DROP INDEX "AgentRun_one_running_per_conversation";
CREATE UNIQUE INDEX "AgentRun_one_running_per_conversation" ON "AgentRun"("conversationId") WHERE "status" IN ('queued','running','waiting_for_approval');
ALTER TABLE "AgentRun" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt">=0),
 ADD COLUMN "leaseOwner" TEXT, ADD COLUMN "leaseUntil" TIMESTAMPTZ(3), ADD COLUMN "heartbeatAt" TIMESTAMPTZ(3),
 ADD COLUMN "executionStartedAt" TIMESTAMPTZ(3), ADD COLUMN "nextSequence" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "progressBytes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "leaseOwner" TEXT, ADD COLUMN "leaseUntil" TIMESTAMPTZ(3), ADD COLUMN "leaseRunId" TEXT;
CREATE TABLE "AgentRunChunk" ("runId" TEXT NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "sequence" INTEGER NOT NULL, "event" JSONB NOT NULL, PRIMARY KEY ("runId","sequence"));
-- Active runs created by older API coordinators are not safe to replay after rollout.
UPDATE "AgentRun" SET "executionStartedAt"="createdAt" WHERE "status" IN ('running','waiting_for_approval');
