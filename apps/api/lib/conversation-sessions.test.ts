import { describe, expect, it } from 'vitest';
import { PORTFOLIO_INSTRUCTION_VERSION, type AgentSessionLocator } from '@portfolio-pilot/agent';
import type { SessionBinding } from '@portfolio-pilot/db';
import { resolveSession } from '../../worker/src/agent-execution';

const SESSION = '5b3f2c1a-8d4e-4f6b-9a7c-2e1d0f9b8a6c';
const locator = (available: boolean | 'throws' = true): AgentSessionLocator => ({ hostKey: 'local:here', modelKey: 'claude:model-a',
  isAvailable: async () => { if (available === 'throws') throw new Error('EACCES /srv/secret'); return available; } });
const binding = (overrides: Partial<SessionBinding> = {}): SessionBinding => ({ sdkSessionId: SESSION, agentMode: 'claude', hostKey: 'local:here', modelKey: 'claude:model-a', instructionVersion: PORTFOLIO_INSTRUCTION_VERSION, generation: 3, ...overrides });

describe('session resolution never assumes a stored ID is portable', () => {
  it('starts a new session for the first turn and reseeds when earlier turns have no recorded session', async () => {
    expect(await resolveSession(null, locator(), false)).toEqual({ resume: null, continuity: { disposition: 'new', reason: null } });
    expect(await resolveSession(null, locator(), true)).toEqual({ resume: null, continuity: { disposition: 'reseeded', reason: 'not_recorded' } });
  });
  it('resumes only a local, present session recorded under the same configuration', async () => {
    expect(await resolveSession(binding(), locator(), true)).toEqual({ resume: SESSION, continuity: { disposition: 'resumed', reason: null } });
  });
  it('reseeds with an explicit reason otherwise', async () => {
    expect((await resolveSession(binding({ modelKey: 'claude:model-b' }), locator(), true)).continuity).toEqual({ disposition: 'reseeded', reason: 'configuration_changed' });
    expect((await resolveSession(binding({ instructionVersion: 'portfolio-research-v1' }), locator(), true)).continuity.reason).toBe('configuration_changed');
    expect((await resolveSession(binding({ hostKey: 'local:another-pod' }), locator(), true)).continuity.reason).toBe('not_local');
    expect((await resolveSession(binding(), locator(false), true)).continuity.reason).toBe('session_missing');
    expect(await resolveSession(binding(), locator('throws'), true)).toEqual({ resume: null, continuity: { disposition: 'reseeded', reason: 'session_missing' } });
  });
});
