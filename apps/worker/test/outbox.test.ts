import { describe, expect, it } from 'vitest';
import { buildEvent, type ClaimedEvent, type OutboxRepository } from '@portfolio-pilot/db';
import { dispatchOnce, sanitizeError } from '../src/outbox.js';

const options = { owner: 'dispatcher', batchSize: 10, leaseMs: 1000, maxAttempts: 3, random: () => 1 };
function claim(attempts: number, kind: 'user' | 'invalid' = 'user'): ClaimedEvent {
  const event = buildEvent({ type: 'portfolio.updated', audience: { kind: 'user', userId: 'alice' }, entityType: 'portfolio', entityId: 'p1', portfolioId: 'p1', payload: { change: 'renamed', transactionId: null } });
  return { id: event.id, claimToken: 'token', attempts, sequence: 1n, event: kind === 'invalid' ? null : event, invalidReason: kind === 'invalid' ? 'Unsupported v9' : null };
}
function fakeRepository(claims: ClaimedEvent[], acknowledged = true) {
  const failures: { error: string; delayMs: number; maxAttempts: number | undefined }[] = [];
  const repository = {
    claim: async () => claims,
    markPublished: async () => acknowledged,
    markFailed: async (c: ClaimedEvent, error: string, delayMs: number, maxAttempts?: number) => { failures.push({ error, delayMs, maxAttempts }); return c.attempts >= (maxAttempts ?? 8) ? 'dead' as const : 'retry' as const; },
    fanOutNews: async () => 0
  } as unknown as OutboxRepository;
  return { repository, failures };
}

describe('outbox dispatcher pass', () => {
  it('publishes and acknowledges claimed events', async () => {
    const published: string[] = [];
    const { repository } = fakeRepository([claim(1), claim(1)]);
    const result = await dispatchOnce(repository, async event => { published.push(event.id); return { streamKey: 's', entryId: '1-0' }; }, options);
    expect(result).toMatchObject({ claimed: 2, published: 2, retried: 0 });
    expect(new Set(published).size).toBe(2);
  });
  it('retries publish failures with exponential backoff, then parks the event as dead', async () => {
    const { repository, failures } = fakeRepository([claim(1), claim(2), claim(3)]);
    const result = await dispatchOnce(repository, async () => { throw new Error('connect ECONNREFUSED redis://user:secret@cache:6379'); }, options);
    expect(result).toMatchObject({ retried: 2, dead: 1, published: 0 });
    expect(failures.map(f => f.delayMs)).toEqual([1000, 2000, 4000]);
    expect(failures[0]!.error).not.toContain('secret');
    expect(failures[0]!.error).toContain('<url>');
  });
  it('counts a fenced acknowledgement as lost, because another dispatcher may republish it', async () => {
    const { repository } = fakeRepository([claim(1)], false);
    expect((await dispatchOnce(repository, async () => ({ streamKey: 's', entryId: '1-0' }), options)).lost).toBe(1);
  });
  it('parks unsupported envelopes immediately without publishing them', async () => {
    const { repository, failures } = fakeRepository([claim(1, 'invalid')]);
    let published = 0;
    const result = await dispatchOnce(repository, async () => { published++; return { streamKey: 's', entryId: '1-0' }; }, options);
    expect(published).toBe(0);
    expect(failures[0]).toMatchObject({ maxAttempts: 0, error: 'Unsupported v9' });
    expect(result.dead).toBe(1);
  });
  it('sanitizes non-error values', () => {
    expect(sanitizeError('boom')).toBe('Unknown publish failure');
  });
});
