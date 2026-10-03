-- Dispatch eligibility uses the database clock only (the claim compares with clock_timestamp()),
-- so a fast application clock can never schedule a fresh event into the future.
ALTER TABLE "OutboxEvent" ALTER COLUMN "availableAt" SET DEFAULT clock_timestamp();
