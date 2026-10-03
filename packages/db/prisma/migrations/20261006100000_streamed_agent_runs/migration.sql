-- Milestone 19: streamed agent runs with explicit cancellation.
ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS "ChatMessage_status_check";
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_status_check" CHECK ("status" IN ('completed', 'failed', 'cancelled'));

CREATE TABLE "AgentRun" (
  "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL,
  "userMessageId" TEXT NOT NULL, "assistantMessageId" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('running', 'completed', 'failed', 'cancelled')),
  "failureCode" VARCHAR(32), "cancelRequestedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AgentRun_terminal_check" CHECK (("status" = 'running') = ("completedAt" IS NULL)),
  CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentRun_userMessageId_key" ON "AgentRun"("userMessageId");
CREATE UNIQUE INDEX "AgentRun_assistantMessageId_key" ON "AgentRun"("assistantMessageId");
CREATE INDEX "AgentRun_conversationId_createdAt_idx" ON "AgentRun"("conversationId", "createdAt");
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");
-- Database backstop for the coordinator: at most one running answer per conversation.
CREATE UNIQUE INDEX "AgentRun_one_running_per_conversation" ON "AgentRun"("conversationId") WHERE "status" = 'running';
