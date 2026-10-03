ALTER TABLE "ConversationSession"
  ADD COLUMN "artifactKey" TEXT,
  ADD COLUMN "artifactSha256" VARCHAR(64),
  ADD COLUMN "artifactExpiresAt" TIMESTAMPTZ(3);
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_artifact_complete"
  CHECK (("artifactKey" IS NULL AND "artifactSha256" IS NULL AND "artifactExpiresAt" IS NULL)
    OR ("artifactKey" IS NOT NULL AND "artifactSha256" ~ '^[a-f0-9]{64}$' AND "artifactExpiresAt" IS NOT NULL));
