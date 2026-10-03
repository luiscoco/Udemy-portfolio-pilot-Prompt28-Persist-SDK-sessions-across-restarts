CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'DEAD');
CREATE TABLE "OutboxEvent" (
 "id" UUID NOT NULL, "sequence" BIGSERIAL NOT NULL,
 "type" VARCHAR(64) NOT NULL, "schemaVersion" INTEGER NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL,
 "audience" VARCHAR(16) NOT NULL, "ownerId" TEXT, "portfolioId" TEXT,
 "entityType" VARCHAR(64) NOT NULL, "entityId" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseOwner" TEXT, "leaseUntil" TIMESTAMPTZ(3), "claimToken" UUID,
 "publishedAt" TIMESTAMPTZ(3), "streamKey" TEXT, "streamEntryId" TEXT, "lastError" VARCHAR(500),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OutboxEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 -- User events must name their owner; market/system events must never carry one.
 CONSTRAINT "OutboxEvent_audience" CHECK (("audience" = 'user' AND "ownerId" IS NOT NULL) OR ("audience" IN ('market', 'system') AND "ownerId" IS NULL)),
 CONSTRAINT "OutboxEvent_schema_version" CHECK ("schemaVersion" >= 1),
 CONSTRAINT "OutboxEvent_attempts" CHECK ("attempts" >= 0),
 CONSTRAINT "OutboxEvent_published" CHECK (("status" = 'PUBLISHED') = ("publishedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "OutboxEvent_sequence_key" ON "OutboxEvent"("sequence");
CREATE INDEX "OutboxEvent_dispatch" ON "OutboxEvent"("status", "availableAt", "sequence");
CREATE INDEX "OutboxEvent_ownerId_sequence_idx" ON "OutboxEvent"("ownerId", "sequence");
CREATE INDEX "OutboxEvent_status_publishedAt_idx" ON "OutboxEvent"("status", "publishedAt");
