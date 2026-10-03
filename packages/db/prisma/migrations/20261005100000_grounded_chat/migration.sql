CREATE TABLE "Conversation" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "title" VARCHAR(100) NOT NULL,
  "portfolioId" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Conversation_ownerId_createdAt_id_idx" ON "Conversation"("ownerId", "createdAt", "id");
CREATE TABLE "ChatMessage" (
  "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL, "sequence" BIGSERIAL NOT NULL UNIQUE,
  "role" VARCHAR(16) NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" VARCHAR(16000) NOT NULL,
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('completed', 'failed')),
  "mode" VARCHAR(16), "instructionVersion" VARCHAR(64), "sources" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatMessage_conversationId_sequence_idx" ON "ChatMessage"("conversationId", "sequence");
