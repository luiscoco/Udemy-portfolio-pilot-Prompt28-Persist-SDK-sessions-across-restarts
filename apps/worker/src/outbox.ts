import type { ClaimedEvent, OutboxRepository } from '@portfolio-pilot/db';
import { retryDelay } from './ingestion.js';

type PublishableEvent = NonNullable<ClaimedEvent['event']>;
export type Publish = (event: PublishableEvent) => Promise<{ streamKey: string; entryId: string }>;
export interface DispatchOptions { owner: string; batchSize: number; leaseMs: number; maxAttempts: number; random?: () => number; processNews?: (eventId: string) => Promise<void> }
export interface DispatchResult { claimed: number; published: number; fannedOut: number; retried: number; dead: number; lost: number }

/** Persisted error text must never carry connection strings or credentials. */
export function sanitizeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown publish failure';
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>').slice(0, 200);
}

/**
 * One dispatcher pass: claim a leased batch, deliver each event in sequence order, then record the
 * outcome with the claim token. A crash between publish and markPublished leaves the row PENDING;
 * after the lease expires it is published again with the SAME event UUID. That is the documented
 * at-least-once duplicate, which consumers absorb by deduplicating on the UUID.
 */
export async function dispatchOnce(repository: OutboxRepository, publish: Publish, options: DispatchOptions): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, published: 0, fannedOut: 0, retried: 0, dead: 0, lost: 0 };
  const claims = await repository.claim(options.owner, { limit: options.batchSize, leaseMs: options.leaseMs, maxAttempts: options.maxAttempts });
  result.claimed = claims.length;
  for (const claim of claims) {
    try {
      if (!claim.event) {
        // An unknown schema version or corrupt payload cannot succeed by retrying; park it for an operator.
        if (await repository.markFailed(claim, claim.invalidReason ?? 'Invalid envelope', 0, 0) === 'dead') result.dead++; else result.lost++;
        continue;
      }
      if (claim.event.audience.kind === 'system') { await repository.fanOutNews(claim); result.fannedOut++; continue; }
      if (claim.event.type === 'news.available') await options.processNews?.(claim.event.id);
      const delivery = await publish(claim.event);
      if (await repository.markPublished(claim, delivery)) result.published++; else result.lost++;
    } catch (error) {
      const outcome = await repository.markFailed(claim, sanitizeError(error), retryDelay(claim.attempts - 1, null, Date.now(), options.random), options.maxAttempts);
      result[outcome === 'retry' ? 'retried' : outcome === 'dead' ? 'dead' : 'lost']++;
    }
  }
  return result;
}
