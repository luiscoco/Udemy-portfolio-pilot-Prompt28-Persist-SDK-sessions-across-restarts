import { expect, it, vi } from 'vitest';
import { ManualClock, MockProviders } from '@portfolio-pilot/providers';
import { ingestOnce, retryDelay } from '../src/ingestion.js';
const epoch = '2026-10-02T12:00:00.000Z';
it('failure does not commit progress and schedules durable retry guidance', async () => {
  const clock = new ManualClock(epoch); const mock = new MockProviders({ clock, scenario: 'outage' });
  const repository = { securities: vi.fn(), commit: vi.fn(), fail: vi.fn() };
  const lease = { key: 'test', owner: 'a', generation: 1, checkpoint: null, cursor: null, mockStartAt: new Date(epoch), failures: 2 };
  expect(await ingestOnce(repository as never, lease, { news: mock, quotes: mock }, 1000, () => 0)).toBe('retry');
  expect(repository.commit).not.toHaveBeenCalled(); expect(repository.fail).toHaveBeenCalledWith(lease, 2000);
});
it('backoff has bounded exponential jitter without truncating provider guidance', () => {
  expect(retryDelay(0, null, 0, () => 0)).toBe(500);
  expect(retryDelay(30, null, 0, () => 1)).toBe(300000);
  expect(retryDelay(1, '1970-01-01T01:00:00Z', 0, () => 0)).toBe(3600000);
});
