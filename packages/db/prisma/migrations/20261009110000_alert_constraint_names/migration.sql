-- Align new foreign-key update actions and Prisma's bounded index name.
ALTER TABLE "AlertRule" DROP CONSTRAINT "AlertRule_ownerId_fkey";
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertNotification" DROP CONSTRAINT "AlertNotification_ownerId_fkey";
ALTER TABLE "AlertNotification" ADD CONSTRAINT "AlertNotification_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertNotification" DROP CONSTRAINT "AlertNotification_ruleId_fkey";
ALTER TABLE "AlertNotification" ADD CONSTRAINT "AlertNotification_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER INDEX "AlertNotification_ownerId_ruleId_ruleRevision_articleId_eventRe" RENAME TO "AlertNotification_ownerId_ruleId_ruleRevision_articleId_eve_key";
