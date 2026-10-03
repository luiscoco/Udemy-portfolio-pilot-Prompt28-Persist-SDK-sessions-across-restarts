import { alertRuleWriteSchema, alertRuleSchema, alertNotificationSchema, type ArticleImpact } from '@portfolio-pilot/contracts';
import { matchesAlert } from '@portfolio-pilot/domain';
import type { PrismaClient, Prisma } from './generated/prisma/client.js';
import { requireOwner, ownerForNewsEvent, type AuthenticatedOwner } from './repositories.js';
import { ownerInterest } from './news-service.js';
import { PortfolioError } from './portfolio-service.js';
import { appendEvent } from './outbox.js';
import { researchService, type AnalyzerBinding } from './research-service.js';

type Rule = Prisma.AlertRuleGetPayload<object>;
const ruleDto = (r: Rule) => alertRuleSchema.parse({ id: r.id, name: r.name, enabled: r.enabled, revision: r.revision, categories: r.categories, securityIds: r.securityIds,
  concentrationThreshold: r.concentrationThreshold?.toFixed() ?? null, relevanceThreshold: r.relevanceThreshold?.toFixed() ?? null, cooldownSeconds: r.cooldownSeconds, createdAt: r.createdAt.toISOString() });
const notificationDto = (r: Prisma.AlertNotificationGetPayload<object>) => alertNotificationSchema.parse({ id: r.id, ruleId: r.ruleId, ruleRevision: r.ruleRevision, articleId: r.articleId,
  eventRevision: r.eventRevision, title: r.title, recommendationIds: r.recommendationIds, createdAt: r.createdAt.toISOString(), dismissedAt: r.dismissedAt?.toISOString() ?? null });

export function alertService(db: PrismaClient, owner: AuthenticatedOwner, clock = () => new Date()) {
  const ownerId = requireOwner(owner);
  const changed = (tx: Prisma.TransactionClient, id: string, change: 'rule.updated' | 'notification.created' | 'notification.dismissed') => appendEvent(tx, {
    type: 'research.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'research', entityId: id, portfolioId: null, payload: { change }
  });
  async function validate(input: unknown) {
    const data = alertRuleWriteSchema.parse(input);
    const allowed = await db.security.findMany({ where: { AND: [{ id: { in: data.securityIds } }, await ownerInterest(db, ownerId)] }, select: { id: true } });
    if (data.securityIds.some(id => !allowed.some(s => s.id === id))) throw new PortfolioError(404, 'Resource not found.');
    return data;
  }
  return {
    rules: async () => (await db.alertRule.findMany({ where: { ownerId, deletedAt: null }, orderBy: { createdAt: 'desc' } })).map(ruleDto),
    async create(input: unknown) {
      const data = await validate(input);
      return db.$transaction(async tx => { const r = await tx.alertRule.create({ data: { ownerId, ...data } }); await changed(tx, r.id, 'rule.updated'); return ruleDto(r); });
    },
    async edit(id: string, input: unknown) {
      const data = await validate(input);
      return db.$transaction(async tx => {
        const result = await tx.alertRule.updateMany({ where: { id, ownerId, deletedAt: null }, data: { ...data, revision: { increment: 1 } } });
        if (!result.count) throw new PortfolioError(404, 'Resource not found.');
        await changed(tx, id, 'rule.updated'); return ruleDto(await tx.alertRule.findUniqueOrThrow({ where: { id } }));
      });
    },
    async remove(id: string) {
      return db.$transaction(async tx => {
        if (!(await tx.alertRule.updateMany({ where: { id, ownerId, deletedAt: null }, data: { enabled: false, deletedAt: clock(), revision: { increment: 1 } } })).count) throw new PortfolioError(404, 'Resource not found.');
        await changed(tx, id, 'rule.updated'); return { removed: true as const };
      });
    },
    notifications: async () => (await db.alertNotification.findMany({ where: { ownerId, suppressed: false }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 })).map(notificationDto),
    async dismiss(id: string) {
      return db.$transaction(async tx => {
        const row = await tx.alertNotification.findFirst({ where: { id, ownerId, suppressed: false } });
        if (!row) throw new PortfolioError(404, 'Resource not found.');
        if (!row.dismissedAt) { await tx.alertNotification.update({ where: { id }, data: { dismissedAt: clock() } }); await changed(tx, id, 'notification.dismissed'); }
        return { dismissed: true as const };
      });
    },
    /** Same revision + rule version yields one immutable decision, including cooldown suppression. */
    async evaluate(impact: ArticleImpact) {
      if (impact.state !== 'current' || !impact.analysis) return;
      const rules = await db.alertRule.findMany({ where: { ownerId, enabled: true, deletedAt: null } });
      for (const candidate of rules) await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "NewsArticle" WHERE "id"=${impact.articleId} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "AlertRule" WHERE "id"=${candidate.id} AND "ownerId"=${ownerId} FOR UPDATE`;
        const rule = await tx.alertRule.findUniqueOrThrow({ where: { id: candidate.id } });
        if (rule.deletedAt || !matchesAlert(ruleDto(rule), impact)) return;
        const key = { ownerId, ruleId: rule.id, ruleRevision: rule.revision, articleId: impact.articleId, eventRevision: impact.analysis!.revisionKey };
        if (await tx.alertNotification.findUnique({ where: { ownerId_ruleId_ruleRevision_articleId_eventRevision: key } })) return;
        // Reject an obsolete impact if a correction committed before evaluation.
        const current = await tx.portfolioImpact.findUnique({ where: { ownerId_articleId: { ownerId, articleId: impact.articleId } } });
        const analysis = await tx.articleAnalysis.findUnique({ where: { id: impact.analysis!.id } });
        if (!current || current.revisionKey !== key.eventRevision || current.analysisId !== impact.analysis!.id || !analysis || analysis.supersededAt) return;
        const now = clock();
        const suppressed = !!rule.lastNotifiedAt && now.getTime() - rule.lastNotifiedAt.getTime() < rule.cooldownSeconds * 1000;
        const row = await tx.alertNotification.create({ data: { ...key, suppressed, title: rule.name, recommendationIds: impact.recommendations.map(r => r.id), createdAt: now } });
        if (!suppressed) { await tx.alertRule.update({ where: { id: rule.id }, data: { lastNotifiedAt: now } }); await changed(tx, row.id, 'notification.created'); }
      });
    }
  };
}

/** Called before acknowledging news delivery. Retries replay the durable decision, never create alerts twice. */
export async function processResearchNews(db: PrismaClient, eventId: string, binding: AnalyzerBinding) {
  const owner = await ownerForNewsEvent(db, eventId);
  const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
  const interest = await ownerInterest(db, owner.userId);
  if (!await db.newsArticle.findFirst({ where: { id: event.entityId, securities: { some: { security: interest } } }, select: { id: true } })) return;
  const impact = await researchService(db, owner, binding).recalculate(event.entityId);
  if (impact.state === 'pending' || impact.state === 'analysis_failed') throw new Error('Research not ready');
  await alertService(db, owner).evaluate(impact);
}
