import { createHash, randomUUID } from 'node:crypto';
import { articleExposure, evidenceSource, generateRecommendations, validateRecommendation, RESEARCH_POLICY, type AnalyzedArticle, type ArticleExposureResult } from '@portfolio-pilot/domain';
import {
  articleAnalysisSchema, articleImpactSchema, recommendationListQuerySchema, recommendationSchema, sharedArticleAnalysisSchema, staleReasonSchema, SENTIMENT_NOTE,
  type ArticleAnalysis, type ArticleAnalysisFailureCode, type ArticleImpact, type Recommendation as RecommendationDto, type SharedArticleAnalysis, type StaleReason
} from '@portfolio-pilot/contracts';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';
import { ownerInterest } from './news-service.js';
import { summaryService } from './summary-service.js';
import { appendEvent } from './outbox.js';
import { recommendationDispositionWriteSchema } from '@portfolio-pilot/contracts';

/**
 * Milestone 21 policy (ADR 0014). The shared analysis is the only model call; everything private is
 * deterministic. Duplicate deliveries of the same article content resolve to the same cache key, and a
 * PostgreSQL claim with a lease (plus in-process single-flight) lets exactly one caller run the model.
 */
export const RESEARCH_CACHE_POLICY = {
  /** A claimed analysis that does not finish within this lease can be claimed again. */
  leaseMs: 90_000,
  /** A failed analysis is not retried for this long, so repeated deliveries cannot loop the model. */
  failedRetryAfterMs: 10 * 60_000,
  /** How long a caller waits for another caller's in-flight analysis before reporting "pending". */
  waitMs: 5_000, pollMs: 100,
  maxRecalculationAttempts: 2, maxPortfolios: 50
} as const;

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Identity of the ACCEPTED article content. A redelivery of identical content yields the same key. */
export function articleRevisionKey(article: Readonly<{ title: string; summary: string; url: string; publishedAt: Date; provider?: string; isSynthetic?: boolean }>, symbols: readonly string[]): string {
  return sha256(['article-revision-v1', article.title, article.summary, article.url, article.publishedAt.toISOString(), [...symbols].sort(), article.provider, article.isSynthetic]);
}
/** The SHARED cache key. It has no owner input by construction, so it can never carry private data. */
export function analysisCacheKey(parts: Readonly<{ articleId: string; revisionKey: string; promptVersion: string; schemaVersion: string; modelKey: string }>): string {
  return sha256(['article-analysis-cache-v1', parts.articleId, parts.revisionKey, parts.promptVersion, parts.schemaVersion, parts.modelKey]);
}

/** Public article fields only; structurally identical to the agent's ArticleAnalysisInput. */
export interface AnalysisInput { articleId: string; title: string; summary: string; url: string; publishedAt: string; provider: string; isSynthetic: boolean; symbols: string[] }
export type AnalysisRunOutcome = { ok: true; analysis: ArticleAnalysis; attempts: number } | { ok: false; code: Exclude<ArticleAnalysisFailureCode, 'unsupported_source'>; attempts: number };
/** The configured analyzer and the versions that, with the article revision, make up the cache key. */
export interface AnalyzerBinding {
  mode: 'mock' | 'claude'; modelKey: string; promptVersion: string; schemaVersion: string;
  run(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisRunOutcome>;
}

const articleInclude = { securities: { include: { security: { select: { id: true, symbol: true } } } } } satisfies Prisma.NewsArticleInclude;
type ArticleRow = Prisma.NewsArticleGetPayload<{ include: typeof articleInclude }>;
type AnalysisRow = Prisma.ArticleAnalysisGetPayload<object>;
type RecommendationRow = Prisma.RecommendationGetPayload<object>;
const revisionOf = (row: ArticleRow) => articleRevisionKey(row, row.securities.map(s => s.security.symbol));
const inputOf = (row: ArticleRow): AnalysisInput => ({ articleId: row.id, title: row.title, summary: row.summary, url: row.url, publishedAt: row.publishedAt.toISOString(), provider: row.provider, isSynthetic: row.isSynthetic, symbols: row.securities.map(s => s.security.symbol).sort() });

/** Canonical records keep their first provider ID; evidence must trust the ACCEPTED observation's provider. */
async function evidenceRows(tx: Prisma.TransactionClient, rows: ArticleRow[]): Promise<ArticleRow[]> {
  const observations = await tx.newsObservation.findMany({ where: { id: { in: rows.flatMap(r => r.acceptedObservationId ? [r.acceptedObservationId] : []) } }, select: { id: true, articleId: true, provider: true } });
  const byId = new Map(observations.map(o => [o.id, o]));
  return rows.map(row => {
    if (!row.acceptedObservationId) return row; // Legacy/seed articles have no observation.
    const accepted = byId.get(row.acceptedObservationId);
    return { ...row, provider: accepted?.articleId === row.id ? accepted.provider : 'unavailable-observation' };
  });
}

export type EnsuredAnalysis = { kind: 'unsupported'; reason: string } | { kind: 'analysis'; row: AnalysisRow; reused: boolean; revisionKey: string };
// Never coalesce calls across database clients: test/tenant databases can share article IDs.
const inflightByDatabase = new WeakMap<PrismaClient, Map<string, Promise<EnsuredAnalysis>>>();

/** Shared, owner-independent analysis cache over PostgreSQL. */
export function sharedAnalyses(db: PrismaClient, binding: AnalyzerBinding) {
  let inflight = inflightByDatabase.get(db);
  if (!inflight) { inflight = new Map(); inflightByDatabase.set(db, inflight); }
  const versions = { promptVersion: binding.promptVersion, schemaVersion: binding.schemaVersion, modelKey: binding.modelKey };
  const cacheKeyOf = (row: ArticleRow) => analysisCacheKey({ articleId: row.id, revisionKey: revisionOf(row), ...versions });
  async function waitFor(cacheKey: string): Promise<AnalysisRow> {
    for (let waited = 0; ; waited += RESEARCH_CACHE_POLICY.pollMs) {
      const row = await db.articleAnalysis.findUniqueOrThrow({ where: { cacheKey } });
      if (row.status !== 'pending' || waited >= RESEARCH_CACHE_POLICY.waitMs) return row;
      await new Promise(resolve => setTimeout(resolve, RESEARCH_CACHE_POLICY.pollMs));
    }
  }
  async function load(row: ArticleRow, revisionKey: string, cacheKey: string, signal?: AbortSignal): Promise<EnsuredAnalysis> {
    const found = await db.articleAnalysis.findUnique({ where: { cacheKey } });
    if (found?.status === 'completed') {
      // The content returned to an earlier revision: that analysis describes the current article again.
      if (found.supersededAt) await db.articleAnalysis.update({ where: { id: found.id }, data: { supersededAt: null } });
      return { kind: 'analysis', row: { ...found, supersededAt: null }, reused: true, revisionKey };
    }
    const token = randomUUID();
    const source = { url: row.url, provider: row.provider, title: row.title, publishedAt: row.publishedAt.toISOString(), isSynthetic: row.isSynthetic };
    // One winner per cache key across processes: insert, or take over an expired lease / a failure past retryAfter.
    const claimed = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "ArticleAnalysis" ("id", "cacheKey", "articleId", "revisionKey", "observationId", "promptVersion", "schemaVersion", "modelKey", "analyzerMode", "status", "source", "claimToken", "leaseUntil")
      VALUES (${randomUUID()}, ${cacheKey}, ${row.id}, ${revisionKey}, ${row.acceptedObservationId}, ${binding.promptVersion}, ${binding.schemaVersion}, ${binding.modelKey}, ${binding.mode}, 'pending',
        ${JSON.stringify(source)}::jsonb, ${token}::uuid, clock_timestamp() + ${RESEARCH_CACHE_POLICY.leaseMs} * interval '1 millisecond')
      ON CONFLICT ("cacheKey") DO UPDATE SET "status"='pending', "claimToken"=EXCLUDED."claimToken", "leaseUntil"=EXCLUDED."leaseUntil", "failureCode"=NULL
      WHERE ("ArticleAnalysis"."status"='pending' AND "ArticleAnalysis"."leaseUntil" < clock_timestamp())
         OR ("ArticleAnalysis"."status"='failed' AND "ArticleAnalysis"."retryAfter" < clock_timestamp())
      RETURNING "id"`;
    if (!claimed.length) return { kind: 'analysis', row: await waitFor(cacheKey), reused: true, revisionKey };
    // Validation can retry a 45s model call. Renew while that bounded run is alive so its
    // second attempt cannot cross the 90s claim lease and start a duplicate model query.
    const heartbeat = setInterval(() => {
      void db.$executeRaw`UPDATE "ArticleAnalysis" SET "leaseUntil"=clock_timestamp() + ${RESEARCH_CACHE_POLICY.leaseMs} * interval '1 millisecond'
        WHERE "cacheKey"=${cacheKey} AND "claimToken"=${token}::uuid AND "status"='pending'`
        .catch(() => { /* Completion remains fenced if another caller takes over during a DB outage. */ });
    }, RESEARCH_CACHE_POLICY.leaseMs / 3);
    heartbeat.unref();
    let outcome: AnalysisRunOutcome;
    try { outcome = await binding.run(inputOf(row), signal); }
    catch (error) {
      // Cancellation or an unexpected fault: release the claim so the next request may retry at once.
      await db.$executeRaw`UPDATE "ArticleAnalysis" SET "status"='failed', "failureCode"='analysis_failed', "retryAfter"=clock_timestamp(), "completedAt"=clock_timestamp(), "claimToken"=NULL, "leaseUntil"=NULL
        WHERE "cacheKey"=${cacheKey} AND "claimToken"=${token}::uuid`;
      throw error;
    } finally { clearInterval(heartbeat); }
    // Fenced by the claim token: a caller whose lease was taken over cannot overwrite the new owner's result.
    if (outcome.ok) await db.$executeRaw`UPDATE "ArticleAnalysis" SET "status"='completed', "analysis"=${JSON.stringify(outcome.analysis)}::jsonb, "attempts"="attempts"+${outcome.attempts},
        "completedAt"=clock_timestamp(), "failureCode"=NULL, "retryAfter"=NULL, "claimToken"=NULL, "leaseUntil"=NULL WHERE "cacheKey"=${cacheKey} AND "claimToken"=${token}::uuid`;
    else await db.$executeRaw`UPDATE "ArticleAnalysis" SET "status"='failed', "failureCode"=${outcome.code}, "attempts"="attempts"+${outcome.attempts}, "completedAt"=clock_timestamp(),
        "retryAfter"=clock_timestamp() + ${RESEARCH_CACHE_POLICY.failedRetryAfterMs} * interval '1 millisecond', "claimToken"=NULL, "leaseUntil"=NULL WHERE "cacheKey"=${cacheKey} AND "claimToken"=${token}::uuid`;
    return { kind: 'analysis', row: await db.articleAnalysis.findUniqueOrThrow({ where: { cacheKey } }), reused: false, revisionKey };
  }
  return {
    cacheKeyOf,
    /** Returns the cached analysis of the article's CURRENT revision, running the analyzer at most once. */
    ensure(row: ArticleRow, signal?: AbortSignal): Promise<EnsuredAnalysis> {
      const decision = evidenceSource(row);
      if (!decision.supported) return Promise.resolve({ kind: 'unsupported', reason: decision.reason });
      const revisionKey = revisionOf(row), cacheKey = analysisCacheKey({ articleId: row.id, revisionKey, ...versions });
      const existing = inflight.get(cacheKey);
      if (existing) return existing;
      const promise = load(row, revisionKey, cacheKey, signal).finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, promise);
      return promise;
    }
  };
}

/**
 * Invalidation policy for a changed article (called inside the ingestion transaction that accepted a
 * correction or merged the article away): analyses of other revisions are marked superseded, and every
 * recommendation citing the article with another revision becomes stale with a visible reason. Nothing
 * is recalculated here: recalculation runs when an owner next requests the impact.
 */
export async function invalidateArticleResearch(tx: Prisma.TransactionClient, articleId: string): Promise<{ analyses: number; recommendations: number }> {
  const stored = await tx.newsArticle.findUnique({ where: { id: articleId }, include: articleInclude });
  const row = stored ? (await evidenceRows(tx, [stored]))[0]! : null;
  const key = row ? revisionOf(row) : null;
  const analyses = key ? await tx.$executeRaw`UPDATE "ArticleAnalysis" SET "supersededAt"=clock_timestamp() WHERE "articleId"=${articleId} AND "supersededAt" IS NULL AND "revisionKey"<>${key}` : 0;
  const reason = JSON.stringify([key ? 'article_corrected' : 'article_withdrawn']);
  const recommendations = await tx.$executeRaw`UPDATE "Recommendation" SET "status"='stale', "updatedAt"=clock_timestamp(),
      "staleReasons"=(SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements_text("staleReasons" || ${reason}::jsonb) AS x)
    WHERE "status" IN ('active', 'stale') AND ${articleId} = ANY("evidenceArticleIds") AND (${key}::text IS NULL OR ("revisionKeys"->>${articleId}) IS DISTINCT FROM ${key}::text)`;
  return { analyses, recommendations };
}

function analysisDto(row: AnalysisRow): SharedArticleAnalysis {
  return sharedArticleAnalysisSchema.parse({ id: row.id, articleId: row.articleId, revisionKey: row.revisionKey, observationId: row.observationId, promptVersion: row.promptVersion, schemaVersion: row.schemaVersion,
    modelKey: row.modelKey, analyzerMode: row.analyzerMode, status: row.status, failureCode: row.failureCode, attempts: row.attempts, analysis: row.analysis ?? null, source: row.source,
    createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, supersededAt: row.supersededAt?.toISOString() ?? null });
}
function analyzedOf(row: ArticleRow, analysis: AnalysisRow): AnalyzedArticle {
  return { analysisId: analysis.id, articleId: row.id, title: row.title, url: row.url, publishedAt: row.publishedAt.toISOString(), revisionKey: analysis.revisionKey,
    securityIds: row.securities.map(s => s.securityId).sort(), analysis: articleAnalysisSchema.parse(analysis.analysis) };
}
const staleReasonsOf = (value: unknown): StaleReason[] => Array.isArray(value) ? value.flatMap(v => { const parsed = staleReasonSchema.safeParse(v); return parsed.success ? [parsed.data] : []; }) : [];

/** Owner-scoped impact and recommendations. Every read and write is bound to the authenticated owner. */
export function researchService(db: PrismaClient, owner: AuthenticatedOwner, binding: AnalyzerBinding, clock: () => Date = () => new Date()) {
  const ownerId = requireOwner(owner);
  const shared = sharedAnalyses(db, binding);
  const policy = { evidenceAgedAfterMs: RESEARCH_POLICY.evidenceAgedAfterMs, concentrationThreshold: '0.2', generatorVersion: RESEARCH_POLICY.generatorVersion };
  const versionChanged = (v: { promptVersion: string; schemaVersion: string; modelKey: string }) => v.promptVersion !== binding.promptVersion || v.schemaVersion !== binding.schemaVersion || v.modelKey !== binding.modelKey;

  async function authorizedArticle(id: string): Promise<ArticleRow> {
    const row = await db.newsArticle.findFirst({ where: { id, securities: { some: { security: await ownerInterest(db, ownerId) } } }, include: articleInclude });
    if (!row) throw new PortfolioError(404, 'Resource not found.');
    return (await evidenceRows(db, [row]))[0]!;
  }
  /** Full immutable ledger and portfolio metadata; a sell/rebuy with unchanged net quantity still invalidates. Quotes are as-of snapshots. */
  async function fingerprint(): Promise<string> {
    return db.$transaction(async tx => {
      const portfolios = await tx.portfolio.findMany({ where: { ownerId, archivedAt: null }, select: { id: true, name: true,
        transactions: { select: { id: true }, orderBy: { ledgerOrder: 'asc' } } }, orderBy: { id: 'asc' } });
      const watch = await tx.watchlistEntry.findMany({ where: { ownerId }, select: { securityId: true }, orderBy: { securityId: 'asc' } });
      // Trades are immutable: their IDs identify quantity, price, fees and chronology without converting decimals.
      return sha256(['portfolio-fingerprint-v2', portfolios, watch]);
    }, { isolationLevel: 'RepeatableRead' });
  }
  async function exposureFor(row: ArticleRow, now: Date): Promise<ArticleExposureResult> {
    const portfolios = await db.portfolio.findMany({ where: { ownerId, archivedAt: null }, select: { id: true }, orderBy: { id: 'asc' }, take: RESEARCH_CACHE_POLICY.maxPortfolios + 1 });
    if (portfolios.length > RESEARCH_CACHE_POLICY.maxPortfolios) throw new PortfolioError(409, 'Too many active portfolios for an impact calculation.');
    const summaries = await Promise.all(portfolios.map(p => summaryService(db, owner).get(p.id, now)));
    const watch = await db.watchlistEntry.findMany({ where: { ownerId }, select: { securityId: true } });
    return articleExposure({ affectedSecurityIds: row.securities.map(s => s.securityId), watchlistSecurityIds: watch.map(w => w.securityId), concentrationThreshold: policy.concentrationThreshold,
      portfolios: summaries.map(s => ({ portfolioId: s.portfolioId, name: s.name, positions: s.positions.map(p => ({ securityId: p.securityId, symbol: p.security.symbol, exchangeMic: p.security.exchangeMic,
        remainingQuantity: p.remainingQuantity, remainingCostBasis: p.remainingCostBasis, marketValue: p.marketValue, quoteStatus: p.quoteStatus })) })) });
  }
  /** Cache only: completed analyses of the CURRENT revision of nearby articles. Never runs the model. */
  async function relatedAnalyzed(subject: ArticleRow, relevant: readonly string[]): Promise<AnalyzedArticle[]> {
    if (!relevant.length) return [];
    const at = subject.publishedAt.getTime(), window = RESEARCH_POLICY.contradictionWindowMs;
    const rows = await evidenceRows(db, await db.newsArticle.findMany({ where: { id: { not: subject.id }, securities: { some: { securityId: { in: [...relevant] } } }, publishedAt: { gte: new Date(at - window), lte: new Date(at + window) } },
      include: articleInclude, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: RESEARCH_POLICY.maxRelatedArticles }));
    const candidates = rows.filter(r => evidenceSource(r).supported).map(r => ({ row: r, cacheKey: shared.cacheKeyOf(r) }));
    const analyses = await db.articleAnalysis.findMany({ where: { cacheKey: { in: candidates.map(c => c.cacheKey) }, status: 'completed' } });
    return candidates.flatMap(c => { const a = analyses.find(x => x.cacheKey === c.cacheKey); return a ? [analyzedOf(c.row, a)] : []; });
  }

  /** Read-time freshness: evidence revisions, portfolio fingerprint and analysis versions are re-checked on every read. */
  async function present(rows: RecommendationRow[], currentFingerprint: string): Promise<RecommendationDto[]> {
    if (!rows.length) return [];
    const now = clock().getTime();
    const articles = await evidenceRows(db, await db.newsArticle.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => r.evidenceArticleIds))] } }, include: articleInclude }));
    const current = new Map(articles.map(a => [a.id, revisionOf(a)]));
    const dtos: RecommendationDto[] = [];
    for (const r of rows) {
      const reasons = new Set(staleReasonsOf(r.staleReasons));
      const analyzed = r.revisionKeys as Record<string, string>;
      for (const id of r.evidenceArticleIds) { const key = current.get(id); if (key === undefined) reasons.add('article_withdrawn'); else if (key !== analyzed[id]) reasons.add('article_corrected'); }
      if (r.portfolioFingerprint !== currentFingerprint) reasons.add('portfolio_changed');
      if (versionChanged(r) || r.generatorVersion !== policy.generatorVersion) reasons.add('analysis_version_changed');
      const sorted = [...reasons].sort();
      const stored = staleReasonsOf(r.staleReasons).sort();
      if (sorted.length && (r.status !== 'stale' || sorted.join() !== stored.join())) {
        await db.recommendation.updateMany({ where: { id: r.id, ownerId, status: { in: ['active', 'stale'] } }, data: { status: 'stale', staleReasons: sorted } });
      }
      const payload = r.payload as Record<string, any>;
      dtos.push(recommendationSchema.parse({
        id: r.id, disposition: r.disposition, articleId: r.articleId, type: r.type, status: sorted.length && r.status !== 'superseded' ? 'stale' : r.status, staleReasons: sorted,
        title: payload.title, rationale: payload.rationale, affectedHoldings: payload.affectedHoldings, affectedSecurities: payload.affectedSecurities,
        uncertainties: payload.uncertainties, counterarguments: payload.counterarguments, sentiment: { label: payload.sentiment, note: SENTIMENT_NOTE },
        evidence: (payload.evidence as Array<Record<string, string>>).map(e => {
          const key = current.get(e.articleId!);
          const status = key === undefined ? 'unavailable' : key !== e.revisionKey ? 'corrected' : now - Date.parse(e.publishedAt!) > RESEARCH_POLICY.evidenceAgedAfterMs ? 'aged' : 'current';
          return { ...e, status };
        }),
        asOf: r.asOf.toISOString(), createdAt: r.createdAt.toISOString(),
        provenance: { generatorVersion: r.generatorVersion, analysisIds: r.analysisIds, promptVersion: r.promptVersion, schemaVersion: r.schemaVersion, modelKey: r.modelKey, portfolioFingerprint: r.portfolioFingerprint, exposureBasis: payload.exposureBasis ?? null }
      }));
    }
    return dtos;
  }

  async function read(articleId: string, extra: { reused?: boolean; attempted?: AnalysisRow } = {}): Promise<ArticleImpact> {
    const row = await authorizedArticle(articleId);
    const revisionKey = revisionOf(row);
    const supported = evidenceSource(row).supported;
    const currentFingerprint = await fingerprint();
    const impact = await db.portfolioImpact.findUnique({ where: { ownerId_articleId: { ownerId, articleId } }, include: { analysis: true } });
    const latest = extra.attempted ?? (supported ? await db.articleAnalysis.findUnique({ where: { cacheKey: shared.cacheKeyOf(row) } }) : null);
    const recommendations = await present(await db.recommendation.findMany({ where: { ownerId, articleId, status: { in: ['active', 'stale'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }), currentFingerprint);
    const reasons = new Set<StaleReason>(recommendations.flatMap(r => r.staleReasons));
    if (impact) {
      if (impact.revisionKey !== revisionKey) reasons.add('article_corrected');
      if (impact.portfolioFingerprint !== currentFingerprint) reasons.add('portfolio_changed');
      if (impact.analysis && versionChanged(impact.analysis)) reasons.add('analysis_version_changed');
      if (impact.generatorVersion !== policy.generatorVersion) reasons.add('analysis_version_changed');
    }
    const state: ArticleImpact['state'] = !supported ? 'unsupported_source' : latest?.status === 'failed' ? 'analysis_failed' : latest?.status === 'pending' ? 'pending'
      : !impact ? 'not_analyzed' : reasons.size ? 'stale' : 'current';
    const shown = impact?.analysis ?? latest ?? null;
    return articleImpactSchema.parse({
      articleId, state, staleReasons: [...reasons].sort(), failureCode: !supported ? 'unsupported_source' : latest?.status === 'failed' ? latest.failureCode : null,
      analysis: shown ? analysisDto(shown) : null, exposure: impact?.exposure ?? null, recommendations, computedAt: impact?.computedAt.toISOString() ?? null,
      analysisReused: extra.reused ?? null, policy
    });
  }

  return {
    /** Persisted impact and recommendations with read-time staleness. Never runs the model. */
    impact: (articleId: string) => read(articleId),
    /** Ensures the shared analysis (cached), then recalculates this owner's exposure and recommendations. */
    async recalculate(articleId: string, signal?: AbortSignal): Promise<ArticleImpact> {
      for (let attempt = 1; ; attempt++) {
        const row = await authorizedArticle(articleId);
        const ensured = await shared.ensure(row, signal);
        if (ensured.kind === 'unsupported') return read(articleId);
        if (ensured.row.status !== 'completed') return read(articleId, { reused: ensured.reused, attempted: ensured.row });
        const now = clock();
        // Fingerprint BEFORE reading holdings: a trade landing in between leaves the result visibly stale, never silently current.
        const portfolioFingerprint = await fingerprint();
        const exposure = await exposureFor(row, now);
        const subject = analyzedOf(row, ensured.row);
        const related = await relatedAnalyzed(row, [...new Set([...exposure.holdings.map(h => h.securityId), ...exposure.watchlistedSecurityIds])]);
        const allowed = new Map([subject, ...related].map(a => [a.analysisId, a]));
        const drafts = generateRecommendations({ subject, related, exposure, securities: row.securities.map(s => ({ securityId: s.securityId, symbol: s.security.symbol })), asOf: now.toISOString() })
          .filter(draft => validateRecommendation(draft, allowed).ok);
        const persisted = await db.$transaction(async tx => {
          // Lock the article revision: a correction committed meanwhile makes this calculation obsolete.
          await tx.$queryRaw`SELECT "id" FROM "NewsArticle" WHERE "id"=${row.id} FOR SHARE`;
          const stored = await tx.newsArticle.findUnique({ where: { id: row.id }, include: articleInclude });
          const current = stored ? (await evidenceRows(tx, [stored]))[0]! : null;
          if (!current || revisionOf(current) !== ensured.revisionKey) return false;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`research:${ownerId}:${row.id}`}))`;
          const impactData = { analysisId: ensured.row.id, revisionKey: ensured.revisionKey, portfolioFingerprint, relevance: exposure.relevance, exposure: exposure as unknown as Prisma.InputJsonValue, generatorVersion: policy.generatorVersion, computedAt: now };
          await tx.portfolioImpact.upsert({ where: { ownerId_articleId: { ownerId, articleId: row.id } }, create: { ownerId, articleId: row.id, ...impactData }, update: impactData });
          const keys: string[] = [];
          for (const draft of drafts) {
            const cited = draft.evidenceArticleIds.map(id => allowed.get(draft.evidence.find(e => e.articleId === id)!.analysisId)!);
            const revisionKeys = Object.fromEntries(cited.map(a => [a.articleId, a.revisionKey]));
            const dedupeKey = sha256(['recommendation-v1', policy.generatorVersion, draft.type, row.id, draft.analysisIds, Object.entries(revisionKeys).sort(), portfolioFingerprint, draft.affectedSecurities.map(s => s.securityId), exposure.basis]);
            keys.push(dedupeKey);
            const payload = { title: draft.title, rationale: draft.rationale, affectedHoldings: draft.affectedHoldings, affectedSecurities: draft.affectedSecurities, uncertainties: draft.uncertainties,
              counterarguments: draft.counterarguments, sentiment: draft.sentiment, exposureBasis: exposure.basis,
              evidence: draft.evidence.map(e => { const a = allowed.get(e.analysisId)!; return { articleId: e.articleId, analysisId: e.analysisId, title: a.title, url: a.url, publishedAt: a.publishedAt, revisionKey: a.revisionKey, statement: e.statement }; }) };
            const data = { status: 'active', staleReasons: [], supersededAt: null, payload, asOf: now };
            const existing = await tx.recommendation.findUnique({ where: { ownerId_dedupeKey: { ownerId, dedupeKey } } });
            const recommendation = await tx.recommendation.upsert({ where: { ownerId_dedupeKey: { ownerId, dedupeKey } }, update: data,
              create: { ...data, ownerId, articleId: row.id, type: draft.type, dedupeKey, analysisIds: draft.analysisIds, evidenceArticleIds: draft.evidenceArticleIds, revisionKeys,
                promptVersion: binding.promptVersion, schemaVersion: binding.schemaVersion, modelKey: binding.modelKey, portfolioFingerprint, generatorVersion: policy.generatorVersion } });
            if (!existing) await appendEvent(tx, { type: 'research.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'research', entityId: recommendation.id, portfolioId: null, payload: { change: 'recommendation.created' } });
          }
          await tx.recommendation.updateMany({ where: { ownerId, articleId: row.id, status: { in: ['active', 'stale'] }, dedupeKey: { notIn: keys } }, data: { status: 'superseded', supersededAt: now } });
          return true;
        });
        if (persisted || attempt >= RESEARCH_CACHE_POLICY.maxRecalculationAttempts) return read(articleId, { reused: ensured.reused });
      }
    },
    async list(input: unknown = {}): Promise<RecommendationDto[]> {
      const query = recommendationListQuerySchema.parse(input);
      const rows = await db.recommendation.findMany({ where: { ownerId, ...(query.status === 'history' ? {} : { status: { in: ['active', 'stale'] }, disposition: query.status === 'saved' ? 'saved' : { not: 'dismissed' } }) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: query.limit });
      const presented = await present(rows, await fingerprint());
      return ['open', 'saved', 'history'].includes(query.status) ? presented : presented.filter(r => r.status === query.status);
    },
    async disposition(id: string, input: unknown) {
      const data = recommendationDispositionWriteSchema.parse(input);
      return db.$transaction(async tx => {
        const updated = await tx.recommendation.updateMany({ where: { id, ownerId }, data });
        if (!updated.count) throw new PortfolioError(404, 'Resource not found.');
        await appendEvent(tx, { type: 'research.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'research', entityId: id, portfolioId: null, payload: { change: 'recommendation.updated' } });
        return { updated: true as const };
      });
    }
  };
}
export type ResearchService = ReturnType<typeof researchService>;
