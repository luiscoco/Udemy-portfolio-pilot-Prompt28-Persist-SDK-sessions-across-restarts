import { z } from 'zod';
import { newsEventCategorySchema } from './news-analysis.js';

const fraction = z.string().regex(/^(0(\.\d{1,10})?|1(\.0{1,10})?)$/);
export const alertRuleWriteSchema = z.object({
  name: z.string().trim().min(1).max(100), enabled: z.boolean().default(true),
  categories: z.array(newsEventCategorySchema).max(20).default([]),
  securityIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  concentrationThreshold: fraction.nullable().default(null),
  relevanceThreshold: fraction.nullable().default(null),
  cooldownSeconds: z.number().int().min(0).max(86400).default(300)
}).strict();
export const alertRuleSchema = alertRuleWriteSchema.extend({ id: z.string(), revision: z.number().int().positive(), createdAt: z.iso.datetime() });
export const alertRuleListSchema = z.object({ rules: z.array(alertRuleSchema) });
export const alertRuleResultSchema = z.object({ rule: alertRuleSchema });
export const alertNotificationSchema = z.object({
  id: z.string(), ruleId: z.string(), ruleRevision: z.number().int().positive(), articleId: z.string(), eventRevision: z.string(),
  title: z.string(), recommendationIds: z.array(z.string()), createdAt: z.iso.datetime(), dismissedAt: z.iso.datetime().nullable()
});
export const alertNotificationListSchema = z.object({ notifications: z.array(alertNotificationSchema) });
export const recommendationDispositionSchema = z.enum(['new', 'saved', 'dismissed']);
export const recommendationDispositionWriteSchema = z.object({ disposition: recommendationDispositionSchema }).strict();
export type AlertRule = z.infer<typeof alertRuleSchema>;
export type AlertRuleWrite = z.infer<typeof alertRuleWriteSchema>;
export type AlertNotification = z.infer<typeof alertNotificationSchema>;
