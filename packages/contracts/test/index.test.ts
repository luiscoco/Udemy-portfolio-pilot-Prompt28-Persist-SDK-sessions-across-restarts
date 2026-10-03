import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, healthResponseSchema } from '../src/index.js';

const requestId = 'cc39aa02-1456-4835-a1d2-f642be67c1a6';
describe('HTTP contracts', () => {
  it('accepts a health response with a UUID request ID', () => {
    expect(healthResponseSchema.parse({ status: 'ok', requestId })).toEqual({ status: 'ok', requestId });
  });
  it('rejects malformed error envelopes', () => {
    expect(() => errorEnvelopeSchema.parse({ error: { code: 'UNKNOWN', message: '', requestId } })).toThrow();
  });
});
