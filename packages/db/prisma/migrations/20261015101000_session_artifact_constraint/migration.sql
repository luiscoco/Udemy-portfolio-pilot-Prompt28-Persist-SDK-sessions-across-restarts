-- SQL CHECK accepts UNKNOWN: require a non-null checksum explicitly for populated pointers.
ALTER TABLE "ConversationSession" DROP CONSTRAINT "ConversationSession_artifact_complete";
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_artifact_complete"
  CHECK (("artifactKey" IS NULL AND "artifactSha256" IS NULL AND "artifactExpiresAt" IS NULL)
    OR ("artifactKey" IS NOT NULL AND "artifactSha256" IS NOT NULL
      AND "artifactSha256" ~ '^[a-f0-9]{64}$' AND "artifactExpiresAt" IS NOT NULL));
