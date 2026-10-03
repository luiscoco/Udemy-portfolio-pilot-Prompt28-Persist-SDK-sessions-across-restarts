import { describe, expect, it } from 'vitest';
import { appEventSchema, eventCursorSchema } from '../src/index.js';

const base = { id: '0b8f4bd4-5f0c-4c55-9a43-3cf0a3a5c1d2', schemaVersion: 1, occurredAt: '2026-10-03T09:00:00.000Z', entityId: 'p1', portfolioId: 'p1' };
const portfolioEvent = { ...base, type: 'portfolio.updated', audience: { kind: 'user', userId: 'u1' }, entityType: 'portfolio', payload: { change: 'created', transactionId: null } };
describe('application event envelope', () => {
  it('accepts a typed, versioned owner event', () => {
    expect(appEventSchema.parse(portfolioEvent).type).toBe('portfolio.updated');
  });
  it('rejects unknown schema versions, non-UUID IDs and extra fields', () => {
    expect(appEventSchema.safeParse({ ...portfolioEvent, schemaVersion: 2 }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...portfolioEvent, id: '1700000000000-0' }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...portfolioEvent, payload: { change: 'created', transactionId: null, ownerEmail: 'x' } }).success).toBe(false);
  });
  it('binds each event type to its audience so private events cannot target the shared market stream', () => {
    expect(appEventSchema.safeParse({ ...portfolioEvent, audience: { kind: 'market' } }).success).toBe(false);
    const quote = { ...base, portfolioId: null, type: 'quote.updated', audience: { kind: 'market' }, entityType: 'quote_batch', payload: { quotes: [{ securityId: 's1', asOf: base.occurredAt }] } };
    expect(appEventSchema.safeParse(quote).success).toBe(true);
    expect(appEventSchema.safeParse({ ...quote, audience: { kind: 'market', userId: 'u1' } }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...quote, payload: { quotes: [{ securityId: 's1', asOf: base.occurredAt, portfolioId: 'p1' }] } }).success).toBe(false);
  });
  it('keeps stream cursors distinct from domain event IDs', () => {
    expect(eventCursorSchema.safeParse(`v1.${base.id}.1700000000000-3`).success).toBe(true);
    expect(eventCursorSchema.safeParse(base.id).success).toBe(false);
  });
});
describe('agent run events (milestone 19)', () => {
  const agent = { ...base, portfolioId: null, entityId: 'run-1', type: 'agent.text.delta', audience: { kind: 'user', userId: 'u1' }, entityType: 'agent_run',
    payload: { conversationId: 'c1', messageId: 'm1', sequence: 3, blockId: 'm1.b0', offset: 12, text: 'visible text' } };
  it('accepts owner-scoped, sequenced text deltas', () => {
    expect(appEventSchema.parse(agent).type).toBe('agent.text.delta');
  });
  it('rejects market audiences, hidden fields, negative sequences and oversized text', () => {
    expect(appEventSchema.safeParse({ ...agent, audience: { kind: 'market' } }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...agent, payload: { ...agent.payload, reasoning: 'hidden' } }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...agent, payload: { ...agent.payload, sequence: -1 } }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...agent, payload: { ...agent.payload, text: 'x'.repeat(8193) } }).success).toBe(false);
    expect(appEventSchema.safeParse({ ...agent, type: 'agent.tool.status', payload: { conversationId: 'c1', messageId: 'm1', sequence: 1, toolCallId: 't', tool: 'Bash', status: 'started' } }).success).toBe(false);
  });
});
