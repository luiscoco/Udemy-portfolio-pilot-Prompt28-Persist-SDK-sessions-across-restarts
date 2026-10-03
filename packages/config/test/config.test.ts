import { describe, expect, it } from 'vitest';
import { parseBrowserConfig } from '../src/browser.js';
import { parseServerConfig } from '../src/server.js';

describe('configuration boundaries', () => {
  it('defaults delegation/MCP off and validates the operator configured live path and dedicated token', () => {
    expect(parseServerConfig({ DATA_MODE: 'mock' })).toMatchObject({ AGENT_SPECIALISTS_ENABLED: false, RESEARCH_MCP_MODE: 'off' });
    expect(() => parseServerConfig({ DATA_MODE: 'mock', RESEARCH_MCP_MODE: 'fixture' })).toThrow();
    const enabled = { DATA_MODE: 'mock', AGENT_SPECIALISTS_ENABLED: 'true', RESEARCH_MCP_MODE: 'live' };
    expect(() => parseServerConfig(enabled)).toThrow();
    expect(() => parseServerConfig({ ...enabled, RESEARCH_MCP_SCRIPT_PATH: 'model-selected.js', RESEARCH_MCP_TOKEN: 'dedicated' })).toThrow();
    expect(parseServerConfig({ ...enabled, RESEARCH_MCP_SCRIPT_PATH: process.platform === 'win32' ? 'C:\\reviewed\\research.mjs' : '/reviewed/research.mjs', RESEARCH_MCP_TOKEN: 'dedicated' }).RESEARCH_MCP_MODE).toBe('live');
  });
  it('defaults empty public placeholders to mock mode', () => {
    expect(parseBrowserConfig({ VITE_APP_NAME: '', VITE_DATA_MODE: '' }).VITE_DATA_MODE).toBe('mock');
  });
  it('rejects secret keys in browser config', () => {
    expect(() => parseBrowserConfig({ DATABASE_URL: 'secret' })).toThrow();
  });
  it('requires explicit data mode and accepts empty credentials in mock mode', () => {
    expect(() => parseServerConfig({ DATA_MODE: '' })).toThrow();
    expect(() => parseServerConfig({})).toThrow();
    expect(parseServerConfig({ DATA_MODE: 'mock', DATABASE_URL: '', REDIS_URL: '' }).DATA_MODE).toBe('mock');
  });
  it('requires live data connections', () => {
    expect(() => parseServerConfig({ DATA_MODE: 'live' })).toThrow();
  });
  it('validates service URL schemes even in mock mode', () => {
    expect(() => parseServerConfig({ DATA_MODE: 'mock', DATABASE_URL: 'https://example.com', REDIS_URL: 'redis://localhost:6379' })).toThrow();
    expect(() => parseServerConfig({ DATA_MODE: 'mock', DATABASE_URL: 'postgresql://localhost:5432/test', REDIS_URL: 'not a url' })).toThrow();
    expect(parseServerConfig({ DATA_MODE: 'mock', DATABASE_URL: 'postgresql://localhost:5432/test', REDIS_URL: 'redis://localhost:6379' }).REDIS_URL).toBe('redis://localhost:6379');
  });
  it('bounds outbox dispatcher settings', () => {
    const config = parseServerConfig({ DATA_MODE: 'mock' });
    expect([config.OUTBOX_BATCH_SIZE, config.OUTBOX_LEASE_MS, config.OUTBOX_MAX_ATTEMPTS, config.OUTBOX_POLL_MS]).toEqual([50, 30000, 8, 500]);
    expect(() => parseServerConfig({ DATA_MODE: 'mock', OUTBOX_MAX_ATTEMPTS: '0' })).toThrow();
    expect(() => parseServerConfig({ DATA_MODE: 'mock', OUTBOX_LEASE_MS: '10' })).toThrow();
  });
  it('requires a model and external workspace in Claude agent mode', () => {
    expect(() => parseServerConfig({ DATA_MODE: 'mock', AGENT_MODE: 'claude' })).toThrow();
    expect(parseServerConfig({ DATA_MODE: 'mock', AGENT_MODE: 'claude', AGENT_MODEL_ID: 'configured-model', AGENT_WORKSPACE_DIR: 'C:\\agent-runtime' }).DATA_MODE).toBe('mock');
  });
});
