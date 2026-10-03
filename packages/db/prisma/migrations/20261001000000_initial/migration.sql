-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TransactionSide" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Security" (
    "id" TEXT NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "exchangeMic" CHAR(4) NOT NULL,
    "name" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "assetType" TEXT NOT NULL DEFAULT 'STOCK',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Security_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioTransaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "side" "TransactionSide" NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "price" DECIMAL(28,10) NOT NULL,
    "fees" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "amount" DECIMAL(38,10) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PortfolioTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "asOf" TIMESTAMPTZ(3) NOT NULL,
    "price" DECIMAL(28,10) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerArticleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticleSecurity" (
    "newsArticleId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NewsArticleSecurity_pkey" PRIMARY KEY ("newsArticleId","securityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

-- CreateIndex
CREATE INDEX "Portfolio_ownerId_createdAt_id_idx" ON "Portfolio"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_ownerId_name_key" ON "Portfolio"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Security_symbol_idx" ON "Security"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Security_exchangeMic_symbol_key" ON "Security"("exchangeMic", "symbol");

-- CreateIndex
CREATE INDEX "PortfolioTransaction_portfolioId_occurredAt_id_idx" ON "PortfolioTransaction"("portfolioId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "PortfolioTransaction_portfolioId_securityId_occurredAt_id_idx" ON "PortfolioTransaction"("portfolioId", "securityId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "PortfolioTransaction_securityId_idx" ON "PortfolioTransaction"("securityId");

-- CreateIndex
CREATE INDEX "WatchlistEntry_ownerId_createdAt_id_idx" ON "WatchlistEntry"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WatchlistEntry_securityId_idx" ON "WatchlistEntry"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEntry_ownerId_securityId_key" ON "WatchlistEntry"("ownerId", "securityId");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_securityId_asOf_idx" ON "QuoteSnapshot"("securityId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteSnapshot_securityId_provider_asOf_key" ON "QuoteSnapshot"("securityId", "provider", "asOf");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_id_idx" ON "NewsArticle"("publishedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_provider_providerArticleId_key" ON "NewsArticle"("provider", "providerArticleId");

-- CreateIndex
CREATE INDEX "NewsArticleSecurity_securityId_newsArticleId_idx" ON "NewsArticleSecurity"("securityId", "newsArticleId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleSecurity" ADD CONSTRAINT "NewsArticleSecurity_newsArticleId_fkey" FOREIGN KEY ("newsArticleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleSecurity" ADD CONSTRAINT "NewsArticleSecurity_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Core scope and decimal invariants. Prisma does not model CHECK constraints.
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_usd" CHECK ("currency" = 'USD');
ALTER TABLE "Security" ADD CONSTRAINT "Security_core_stock" CHECK (
  "currency" = 'USD' AND "assetType" = 'STOCK'
  AND "exchangeMic" ~ '^[A-Z0-9]{4}$'
  AND "symbol" = upper("symbol") AND length(trim("symbol")) > 0
);
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_values" CHECK (
  "quantity" > 0 AND "quantity" <> 'NaN'::numeric
  AND "price" > 0 AND "price" <> 'NaN'::numeric
  AND "fees" >= 0 AND "fees" <> 'NaN'::numeric
  AND "amount" >= 0 AND "amount" <> 'NaN'::numeric
  AND "amount" = round(CASE WHEN "side" = 'BUY'
    THEN "quantity" * "price" + "fees"
    ELSE "quantity" * "price" - "fees" END, 10)
);
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_values" CHECK (
  "currency" = 'USD' AND "price" > 0 AND "price" <> 'NaN'::numeric
);

