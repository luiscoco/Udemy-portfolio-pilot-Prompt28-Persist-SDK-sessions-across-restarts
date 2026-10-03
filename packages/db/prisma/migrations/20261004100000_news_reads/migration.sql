CREATE TABLE "NewsRead" (
  "ownerId" TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readRevisionAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "NewsRead_pkey" PRIMARY KEY ("ownerId", "articleId"),
  CONSTRAINT "NewsRead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "NewsRead_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE
);
