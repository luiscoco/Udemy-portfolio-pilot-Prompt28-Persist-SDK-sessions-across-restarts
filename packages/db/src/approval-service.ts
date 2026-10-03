import { assertRunFence, type RunFence } from './run-lease.js';
import { createHash, randomUUID } from 'node:crypto';
import { alertRuleSchema, approvalSchema, approvalDecisionSchema, proposedChangeSchema, type ProposedChange } from '@portfolio-pilot/contracts';
import type { PrismaClient, Prisma } from './generated/prisma/client.js';
import { requireOwner, type AuthenticatedOwner } from './repositories.js';
import { PortfolioError } from './portfolio-service.js';
import { appendEvent } from './outbox.js';
import { ownerInterest } from './news-service.js';

// Stable recursive serialization: object key order cannot alter an approval binding.
export function canonicalArguments(value: unknown): string {
 if (Array.isArray(value)) return '[' + value.map(canonicalArguments).join(',') + ']';
 if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalArguments((value as Record<string, unknown>)[k])).join(',') + '}';
 return JSON.stringify(value);
}
export const approvalHash = (input: unknown) => createHash('sha256').update(canonicalArguments(proposedChangeSchema.parse(input))).digest('hex');
const active = ['running', 'waiting_for_approval'];
const dto = (r: Prisma.ApprovalRequestGetPayload<object>) => approvalSchema.parse({ ...r, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() });
export function approvalService(db: PrismaClient, owner: AuthenticatedOwner, clock = () => new Date(), fence?: RunFence) {
 const ownerId = requireOwner(owner);
 async function lockRun(tx: Prisma.TransactionClient, runId: string) {
  await tx.$queryRaw`SELECT r."id" FROM "AgentRun" r JOIN "Conversation" c ON c."id"=r."conversationId" WHERE r."id"=${runId} AND c."ownerId"=${ownerId} FOR UPDATE OF r`;
  const run = await tx.agentRun.findFirst({ where: { id: runId, conversation: { ownerId } } });
  if (!run) throw new PortfolioError(404, 'Resource not found.');
  return run;
 }
 async function state(tx: Prisma.TransactionClient, change: ProposedChange) {
  if (change.actionType === 'watchlist.add') {
   const security = await tx.security.findFirst({ where: { ...change.arguments, currency: 'USD', assetType: 'STOCK' } });
   if (!security) throw new PortfolioError(400, 'Unknown USD stock identity.');
   const entry = await tx.watchlistEntry.findUnique({ where: { ownerId_securityId: { ownerId, securityId: security.id } } });
   return { securityId: security.id, symbol: security.symbol, exchangeMic: security.exchangeMic, watchlisted: !!entry };
  }
  const { ruleId, expectedRevision, rule } = change.arguments;
  const current = await tx.alertRule.findFirst({ where: { id: ruleId, ownerId, deletedAt: null } });
  if (!current) throw new PortfolioError(404, 'Resource not found.');
  if (current.revision !== expectedRevision) throw new PortfolioError(409, 'Alert changed. Request a new proposal.');
  const allowed = await tx.security.findMany({ where: { AND: [{ id: { in: rule.securityIds } }, await ownerInterest(tx, ownerId)] } });
  if (rule.securityIds.some(id => !allowed.some(s => s.id === id))) throw new PortfolioError(404, 'Resource not found.');
  return { id: current.id, revision: current.revision, name: current.name, enabled: current.enabled, categories: current.categories, securityIds: current.securityIds,
   concentrationThreshold: current.concentrationThreshold?.toFixed() ?? null, relevanceThreshold: current.relevanceThreshold?.toFixed() ?? null, cooldownSeconds: current.cooldownSeconds };
 }
 async function get(id: string) {
  await db.approvalRequest.updateMany({ where: { id, ownerId, status: { in: ['pending','approved'] }, expiresAt: { lte: clock() } }, data: { status: 'expired' } });
  const row = await db.approvalRequest.findFirst({ where: { id, ownerId, run: { conversation: { ownerId } } } });
  if (!row) throw new PortfolioError(404, 'Resource not found.');
  return dto(row);
 }
 async function expire(runId: string) {
  await db.approvalRequest.updateMany({ where: { ownerId, runId, status: { in: ['pending','approved'] }, expiresAt: { lte: clock() } }, data: { status: 'expired' } });
 }
 return {
  get,
  async rules() { return (await db.alertRule.findMany({ where: { ownerId, deletedAt: null }, take: 20, orderBy: { createdAt: 'desc' } })).map(r => alertRuleSchema.parse({ ...r, concentrationThreshold: r.concentrationThreshold?.toFixed() ?? null, relevanceThreshold: r.relevanceThreshold?.toFixed() ?? null, createdAt: r.createdAt.toISOString() })); },
  async list(runId: string) { await lockRead(runId); await expire(runId); return (await db.approvalRequest.findMany({ where: { ownerId, runId }, orderBy: { createdAt: 'asc' }, take: 20 })).map(dto); },
  async propose(runId: string, input: unknown) {
   const change = proposedChangeSchema.parse(input);
   return db.$transaction(async tx => {
    const run = await lockRun(tx, runId);
    if (!fence || fence.runId !== runId) throw new PortfolioError(409, "A worker attempt is required.");
    await assertRunFence(tx, fence);
    if (!active.includes(run.status) || run.cancelRequestedAt) throw new PortfolioError(409, 'Run is no longer active.');
    if (await tx.approvalRequest.count({ where: { runId } }) >= 10) throw new PortfolioError(409, 'Proposal limit reached.');
    const before = await state(tx, change);
    if (change.actionType === 'watchlist.add' && 'watchlisted' in before && before.watchlisted) throw new PortfolioError(409, 'This stock is already watchlisted.');
    const row = await tx.approvalRequest.create({ data: { id: randomUUID(), mutationId: randomUUID(), ownerId, runId, actionType: change.actionType,
     arguments: change.arguments, argumentHash: approvalHash(change), before, status: 'pending', expiresAt: new Date(clock().getTime() + 60000) } });
    await tx.agentRun.update({ where: { id: runId }, data: { status: 'waiting_for_approval' } });
    return dto(row);
   });
  },
  async decide(id: string, decision: 'approved' | 'rejected', input: unknown) {
   const { argumentHash } = approvalDecisionSchema.parse(input);
   const approval = await get(id);
   const result = await db.$transaction(async tx => {
    const run = await lockRun(tx, approval.runId);
    const row = await tx.approvalRequest.findFirstOrThrow({ where: { id, ownerId } });
    if (argumentHash !== row.argumentHash || approvalHash({ actionType: row.actionType, arguments: row.arguments }) !== row.argumentHash) throw new PortfolioError(409, 'Arguments changed. Request a new approval.');
    if (row.status === 'consumed' || (row.status === 'rejected' && decision === 'rejected')) return { approval: dto(row), error: null };
    if (!['pending','approved'].includes(row.status)) return { approval: dto(row), error: 'Approval is no longer pending.' };
    let status: string = row.status === 'approved' ? 'approved' : decision, error: string | null = row.status === 'approved' && decision === 'rejected' ? 'Approval was already granted.' : null;
    if (row.expiresAt <= clock()) { status = 'expired'; error = 'Approval expired. Request a new proposal.'; }
    else if (!active.includes(run.status) || run.cancelRequestedAt) { status = 'cancelled'; error = 'Run is no longer active.'; }
    else if (!(await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AgentRun" WHERE "id"=${run.id} AND "leaseUntil">clock_timestamp()`).length) { status = 'invalidated'; error = 'Worker lease expired. Send a new proposal after recovery.'; }
    else if (decision === 'approved') {
     try { const current = await state(tx, proposedChangeSchema.parse({ actionType: row.actionType, arguments: row.arguments }));
      if (canonicalArguments(current) !== canonicalArguments(row.before)) { status = 'invalidated'; error = 'Resource changed. Request a new proposal.'; }
     } catch (e) { if (!(e instanceof PortfolioError)) throw e; status = 'invalidated'; error = 'Resource changed. Request a new proposal.'; }
    }
    const updated = await tx.approvalRequest.update({ where: { id }, data: { status } });
    return { approval: dto(updated), error };
   });
   if (result.error) throw new PortfolioError(409, result.error);
   return result.approval;
  },
  async consume(id: string, runId: string, input: unknown) {
   const change = proposedChangeSchema.parse(input);
   await expire(runId);
   return db.$transaction(async tx => {
    const run = await lockRun(tx, runId);
    if (!fence || fence.runId !== runId) throw new PortfolioError(409, "A worker attempt is required.");
    await assertRunFence(tx, fence);
    const row = await tx.approvalRequest.findFirst({ where: { id, ownerId, runId } });
    if (!row) throw new PortfolioError(404, 'Resource not found.');
    if (row.argumentHash !== approvalHash(change) || canonicalArguments(row.arguments) !== canonicalArguments(change.arguments) || row.actionType !== change.actionType) throw new PortfolioError(409, 'Arguments changed. A new approval is required.');
    // Replay returns only the already committed receipt, never executes another mutation.
    if (row.status === 'consumed') return { mutationId: row.mutationId, applied: true };
    if (row.status !== 'approved' || row.expiresAt <= clock() || run.cancelRequestedAt || !active.includes(run.status)) throw new PortfolioError(409, 'Approval cannot be used.');
    const current = await state(tx, change);
    if (canonicalArguments(current) !== canonicalArguments(row.before)) throw new PortfolioError(409, 'Resource changed. A new approval is required.');
    if (change.actionType === 'watchlist.add' && 'securityId' in current) {
     const inserted = await tx.watchlistEntry.createMany({ data: [{ id: row.mutationId, ownerId, securityId: current.securityId }], skipDuplicates: true });
     if (!inserted.count) throw new PortfolioError(409, 'Watchlist changed. Request a new proposal.');
     await appendEvent(tx, { type: 'watchlist.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'watchlist_entry', entityId: row.mutationId, portfolioId: null, payload: { change: 'added', securityId: current.securityId } });
    } else if (change.actionType === 'alert.update') {
     const moved = await tx.alertRule.updateMany({ where: { id: change.arguments.ruleId, ownerId, revision: change.arguments.expectedRevision, deletedAt: null }, data: { ...change.arguments.rule, revision: { increment: 1 } } });
     if (!moved.count) throw new PortfolioError(409, 'Alert changed. Request a new proposal.');
     await appendEvent(tx, { id: row.mutationId, type: 'research.updated', audience: { kind: 'user', userId: ownerId }, entityType: 'research', entityId: change.arguments.ruleId, portfolioId: null, payload: { change: 'rule.updated' } });
    }
    await tx.approvalRequest.update({ where: { id }, data: { status: 'consumed', consumedAt: clock() } });
    await tx.agentRun.update({ where: { id: runId }, data: { status: 'running' } });
    return { mutationId: row.mutationId, applied: true };
   });
  }
 };
 async function lockRead(runId: string) {
  if (!await db.agentRun.findFirst({ where: { id: runId, conversation: { ownerId } } })) throw new PortfolioError(404, 'Resource not found.');
 }
}
export type ApprovalService = ReturnType<typeof approvalService>;
