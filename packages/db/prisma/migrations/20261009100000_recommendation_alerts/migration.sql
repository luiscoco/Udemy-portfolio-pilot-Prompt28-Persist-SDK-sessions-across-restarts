ALTER TABLE "Recommendation" ADD COLUMN "disposition" VARCHAR(16) NOT NULL DEFAULT 'new';
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_disposition_check" CHECK ("disposition" IN ('new','saved','dismissed'));
CREATE TABLE "AlertRule" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1,
  "categories" TEXT[] NOT NULL, "securityIds" TEXT[] NOT NULL,
  "concentrationThreshold" DECIMAL(11,10), "relevanceThreshold" DECIMAL(11,10),
  "cooldownSeconds" INTEGER NOT NULL DEFAULT 300, "lastNotifiedAt" TIMESTAMPTZ(3), "deletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("revision" > 0), CHECK ("cooldownSeconds" BETWEEN 0 AND 86400),
  CHECK ("concentrationThreshold" BETWEEN 0 AND 1), CHECK ("relevanceThreshold" BETWEEN 0 AND 1)
);
CREATE INDEX "AlertRule_ownerId_deletedAt_idx" ON "AlertRule"("ownerId","deletedAt");
CREATE TABLE "AlertNotification" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL REFERENCES "AlertRule"("id") ON DELETE CASCADE,
  "ruleRevision" INTEGER NOT NULL, "articleId" TEXT NOT NULL, "eventRevision" CHAR(64) NOT NULL,
  "title" TEXT NOT NULL, "recommendationIds" TEXT[] NOT NULL, "suppressed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dismissedAt" TIMESTAMPTZ(3),
  CHECK ("ruleRevision" > 0)
);
CREATE UNIQUE INDEX "AlertNotification_ownerId_ruleId_ruleRevision_articleId_eventRevision_key" ON "AlertNotification"("ownerId","ruleId","ruleRevision","articleId","eventRevision");
CREATE INDEX "AlertNotification_ownerId_createdAt_id_idx" ON "AlertNotification"("ownerId","createdAt","id");
