ALTER TABLE "NewsArticle" ADD COLUMN "canonicalKey" TEXT;
CREATE UNIQUE INDEX "NewsArticle_canonicalKey_key" ON "NewsArticle"("canonicalKey");
CREATE TABLE "IngestionState" (
 "key" TEXT PRIMARY KEY, "checkpoint" TEXT, "cursor" TEXT,
 "mockStartAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseOwner" TEXT, "leaseUntil" TIMESTAMPTZ(3), "generation" INTEGER NOT NULL DEFAULT 0,
 "failures" INTEGER NOT NULL DEFAULT 0, "nextRunAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "NewsSource" (
 "provider" TEXT NOT NULL, "recordId" TEXT NOT NULL,
 "articleId" TEXT NOT NULL REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 PRIMARY KEY ("provider", "recordId")
);
CREATE INDEX "NewsSource_articleId_idx" ON "NewsSource"("articleId");
CREATE TABLE "NewsUrl" (
 "url" TEXT PRIMARY KEY,
 "articleId" TEXT NOT NULL REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NewsUrl_articleId_idx" ON "NewsUrl"("articleId");
CREATE TABLE "NewsObservation" (
 "id" TEXT PRIMARY KEY, "articleId" TEXT NOT NULL REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "provider" TEXT NOT NULL, "recordId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "providerAt" TIMESTAMPTZ(3) NOT NULL, "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "metadata" JSONB NOT NULL,
 UNIQUE ("provider", "recordId", "fingerprint")
);
CREATE INDEX "NewsObservation_articleId_providerAt_idx" ON "NewsObservation"("articleId", "providerAt");
