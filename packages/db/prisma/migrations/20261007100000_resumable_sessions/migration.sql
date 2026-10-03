-- Milestone 20: SDK session binding (separate from application chat history) and structured analysis.

-- At most one CURRENT SDK session per conversation. The transcript itself lives in the SDK's local
-- session files on one host; this row only says which session that is and where it was created.
CREATE TABLE "ConversationSession" (
  "conversationId" TEXT PRIMARY KEY,
  "sdkSessionId" VARCHAR(64) NOT NULL,
  "agentMode" VARCHAR(16) NOT NULL CHECK ("agentMode" IN ('mock', 'claude')),
  "hostKey" VARCHAR(64) NOT NULL,
  "instructionVersion" VARCHAR(64) NOT NULL,
  "modelKey" VARCHAR(128) NOT NULL,
  -- Compare-and-set counter: a binding is replaced only by the writer that read this generation.
  "generation" INTEGER NOT NULL DEFAULT 1 CHECK ("generation" > 0),
  "lastRunId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConversationSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "ChatMessage" ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'answer' CHECK ("kind" IN ('answer', 'news_analysis'));
ALTER TABLE "ChatMessage" ADD COLUMN "analysis" JSONB;
ALTER TABLE "ChatMessage" ADD COLUMN "continuity" JSONB;

ALTER TABLE "AgentRun" ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'answer' CHECK ("kind" IN ('answer', 'news_analysis'));
ALTER TABLE "AgentRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0);
