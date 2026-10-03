import { authenticateOwner, chatService, getDatabase, newsReads, ownerRepositories, portfolioService, quoteReads, recoverySnapshot, researchService, summaryService, watchlistService } from '@portfolio-pilot/db';
import { approvalService, alertService } from '@portfolio-pilot/db';
import { defaultAnalyzerBinding } from './research';
import { portfolioToolContext } from './agent-tools';
import { applicationCache, optionalRedis } from './cache';
import { parseServerConfig } from '@portfolio-pilot/config/server';
import { getAuthentication, assertMutationOrigin } from './auth';
import { errorResponse, getRequestId } from './http';

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403 | 404, message: string) { super(message); }
}
type Authorization = { approvals: ReturnType<typeof approvalService>; alerts: ReturnType<typeof alertService>;
  chat: ReturnType<typeof chatService>;
  agentTools: ReturnType<typeof portfolioToolContext>;
  user: { id: string; name: string; email: string };
  expiresAt: Date;
  repositories: ReturnType<typeof ownerRepositories>;
  portfolios: ReturnType<typeof portfolioService>;
  summaries: ReturnType<typeof summaryService>;
  watchlist: ReturnType<typeof watchlistService>;
  news: ReturnType<typeof newsReads>;
  quotes: ReturnType<typeof quoteReads>;
  research: ReturnType<typeof researchService>;
  recovery: () => ReturnType<typeof recoverySnapshot>;
};
export async function requireAuthorization(request: Request): Promise<Authorization> {
  try { assertMutationOrigin(request); } catch { throw new AccessError(403, 'Untrusted request origin.'); }
  const auth = await getAuthentication();
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session) throw new AccessError(401, 'Sign in to continue.');
  const db = await getDatabase(parseServerConfig(process.env).DATABASE_URL!);
  // A second current DB check mints the opaque repository context, never a browser ID.
  let owner;
  try { owner = await authenticateOwner(db, session.session.token); }
  catch { throw new AccessError(401, 'Sign in to continue.'); }
  const cache = applicationCache();
  return { approvals: approvalService(db, owner), alerts: alertService(db, owner), chat: chatService(db, owner), agentTools: portfolioToolContext(db, cache, owner, parseServerConfig(process.env).DATA_MODE), user: session.user, expiresAt: session.session.expiresAt, repositories: ownerRepositories(db, owner), portfolios: portfolioService(db, owner), summaries: summaryService(db, owner), watchlist: watchlistService(db, owner),
    news: newsReads(db, cache, owner), quotes: quoteReads(db, cache), research: researchService(db, owner, defaultAnalyzerBinding()),
    // A Redis outage degrades recovery to snapshot-only (null cursors) within one second.
    recovery: async () => recoverySnapshot(db, await Promise.race([optionalRedis().catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]), cache, owner) };
}
export async function requirePortfolio(request: Request, id: string): Promise<Authorization & {
  portfolio: NonNullable<Awaited<ReturnType<Authorization['repositories']['getPortfolio']>>>;
}> {
  const authorization = await requireAuthorization(request);
  const portfolio = await authorization.repositories.getPortfolio(id);
  if (!portfolio) throw new AccessError(404, 'Resource not found.');
  return { ...authorization, portfolio };
}
export function accessResponse(request: Request, error: unknown): Response {
  const status = error instanceof AccessError ? error.status : 503;
  if (status === 503) console.error('API dependency operation failed.', { kind: error instanceof Error && ['PrismaClientKnownRequestError', 'PrismaClientValidationError', 'PrismaClientUnknownRequestError'].includes(error.name) ? error.name : 'unknown' });
  const code = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR';
  const response = errorResponse(code, error instanceof AccessError ? error.message : 'Service unavailable.', getRequestId(request), status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

