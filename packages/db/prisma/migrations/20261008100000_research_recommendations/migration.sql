-- Milestone 21: shared article analysis cache, private portfolio impact and research recommendations.

-- SHARED and user-independent: there is deliberately no owner column. One row per cache key.
CREATE TABLE "ArticleAnalysis" (
  "id" TEXT PRIMARY KEY,
  "cacheKey" CHAR(64) NOT NULL,
  "articleId" TEXT NOT NULL,
  "revisionKey" CHAR(64) NOT NULL,
  "observationId" TEXT,
  "promptVersion" VARCHAR(64) NOT NULL,
  "schemaVersion" VARCHAR(64) NOT NULL,
  "modelKey" VARCHAR(128) NOT NULL,
  "analyzerMode" VARCHAR(16) NOT NULL CHECK ("analyzerMode" IN ('mock', 'claude')),
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('pending', 'completed', 'failed')),
  "failureCode" VARCHAR(40),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "analysis" JSONB,
  "source" JSONB NOT NULL,
  "claimToken" UUID,
  "leaseUntil" TIMESTAMPTZ(3),
  "retryAfter" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "supersededAt" TIMESTAMPTZ(3),
  CONSTRAINT "ArticleAnalysis_completed_has_analysis" CHECK ("status" <> 'completed' OR "analysis" IS NOT NULL),
  CONSTRAINT "ArticleAnalysis_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ArticleAnalysis_cacheKey_key" ON "ArticleAnalysis"("cacheKey");
CREATE INDEX "ArticleAnalysis_articleId_createdAt_idx" ON "ArticleAnalysis"("articleId", "createdAt");

-- PRIVATE: always owner-scoped.
CREATE TABLE "PortfolioImpact" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "analysisId" TEXT,
  "revisionKey" CHAR(64) NOT NULL,
  "portfolioFingerprint" CHAR(64) NOT NULL,
  "relevance" VARCHAR(16) NOT NULL CHECK ("relevance" IN ('held', 'watchlisted', 'none')),
  "exposure" JSONB NOT NULL,
  "generatorVersion" VARCHAR(64) NOT NULL,
  "computedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PortfolioImpact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PortfolioImpact_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PortfolioImpact_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ArticleAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PortfolioImpact_ownerId_articleId_key" ON "PortfolioImpact"("ownerId", "articleId");

-- PRIVATE. No FK to NewsArticle: a recommendation citing a merged-away article stays visible as a
-- stale record with provenance ("article_withdrawn") instead of silently disappearing.
CREATE TABLE "Recommendation" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "type" VARCHAR(32) NOT NULL CHECK ("type" IN ('monitor_event', 'review_concentration', 'read_primary_source', 'reassess_assumptions')),
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('active', 'stale', 'superseded')),
  "staleReasons" JSONB NOT NULL DEFAULT '[]',
  "dedupeKey" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "analysisIds" TEXT[] NOT NULL,
  "evidenceArticleIds" TEXT[] NOT NULL CHECK (cardinality("evidenceArticleIds") > 0),
  "revisionKeys" JSONB NOT NULL,
  "promptVersion" VARCHAR(64) NOT NULL,
  "schemaVersion" VARCHAR(64) NOT NULL,
  "modelKey" VARCHAR(128) NOT NULL,
  "portfolioFingerprint" CHAR(64) NOT NULL,
  "generatorVersion" VARCHAR(64) NOT NULL,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "supersededAt" TIMESTAMPTZ(3),
  CONSTRAINT "Recommendation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Recommendation_ownerId_dedupeKey_key" ON "Recommendation"("ownerId", "dedupeKey");
CREATE INDEX "Recommendation_ownerId_status_createdAt_idx" ON "Recommendation"("ownerId", "status", "createdAt");
CREATE INDEX "Recommendation_ownerId_articleId_idx" ON "Recommendation"("ownerId", "articleId");
-- SQL only (not expressible in the Prisma schema): invalidation finds every recommendation citing a changed article.
CREATE INDEX "Recommendation_evidenceArticleIds_gin" ON "Recommendation" USING GIN ("evidenceArticleIds");
