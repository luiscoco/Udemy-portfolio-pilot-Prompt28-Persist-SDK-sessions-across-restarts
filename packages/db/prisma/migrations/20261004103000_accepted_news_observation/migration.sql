ALTER TABLE "NewsArticle" ADD COLUMN IF NOT EXISTS "acceptedObservationId" TEXT;
UPDATE "NewsArticle" a SET "acceptedObservationId" = (
  SELECT o."id" FROM "NewsObservation" o WHERE o."articleId" = a."id"
    AND o."metadata"->>'title' = a."title"
    AND o."metadata"->>'summary' = a."summary"
    AND o."metadata"->>'canonicalUrl' = a."url"
  ORDER BY o."providerAt" DESC, o."observedAt" DESC, o."id" ASC LIMIT 1
);
