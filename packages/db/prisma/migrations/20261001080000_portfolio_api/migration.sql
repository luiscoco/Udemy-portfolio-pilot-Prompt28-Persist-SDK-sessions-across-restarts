ALTER TABLE "Portfolio" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "PortfolioTransaction" ADD COLUMN "ledgerOrder" BIGSERIAL,
  ADD COLUMN "idempotencyKey" VARCHAR(128), ADD COLUMN "requestFingerprint" VARCHAR(64);
WITH ordered AS (SELECT id, row_number() OVER (ORDER BY "occurredAt", id) AS n FROM "PortfolioTransaction")
UPDATE "PortfolioTransaction" t SET "ledgerOrder" = ordered.n FROM ordered WHERE t.id = ordered.id;
SELECT setval(pg_get_serial_sequence('"PortfolioTransaction"', 'ledgerOrder'),
  COALESCE((SELECT max("ledgerOrder") FROM "PortfolioTransaction"), 1), EXISTS(SELECT 1 FROM "PortfolioTransaction"));
CREATE UNIQUE INDEX "PortfolioTransaction_ledgerOrder_key" ON "PortfolioTransaction"("ledgerOrder");
CREATE UNIQUE INDEX "PortfolioTransaction_portfolioId_idempotencyKey_key" ON "PortfolioTransaction"("portfolioId", "idempotencyKey");
CREATE INDEX "PortfolioTransaction_ledger_page" ON "PortfolioTransaction"("portfolioId", "occurredAt", "ledgerOrder");
ALTER TABLE "PortfolioTransaction" ADD CONSTRAINT "PortfolioTransaction_idempotency_pair"
  CHECK (("idempotencyKey" IS NULL) = ("requestFingerprint" IS NULL));
