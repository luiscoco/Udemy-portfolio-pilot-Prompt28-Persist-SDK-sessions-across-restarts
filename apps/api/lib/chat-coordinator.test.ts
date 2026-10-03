import { expect, it, vi } from 'vitest';
import { LocalRunCoordinator, stopReason } from './testing/local-coordinator';

it('enforces conversation, owner and global admission limits, releasing after failure', async () => {
  const coordinator = new LocalRunCoordinator(2, 1);
  let finish!: () => void;
  const first = coordinator.admit('alice', 'a').launch('r1', () => new Promise<void>(resolve => { finish = resolve; }));
  expect(() => coordinator.admit('bob', 'a')).toThrow(expect.objectContaining({ status: 409 }));
  expect(() => coordinator.admit('alice', 'b')).toThrow(expect.objectContaining({ status: 409 }));
  let endSecond!: () => void;
  const second = coordinator.admit('bob', 'b').launch('r2', () => new Promise<void>(resolve => { endSecond = resolve; }));
  expect(() => coordinator.admit('carol', 'c')).toThrow(expect.objectContaining({ status: 409 }));
  await Promise.resolve(); // work starts on a microtask, so a synchronous throw cannot escape launch()
  finish(); endSecond(); await Promise.all([first, second]);
  await coordinator.admit('alice', 'a').launch('r3', async () => { throw new Error('test'); });
  expect(coordinator.activeCount).toBe(0);
  // A slot whose run never launched is released explicitly (idempotently).
  const unused = coordinator.admit('alice', 'a'); unused.release(); unused.release();
  expect(coordinator.activeCount).toBe(0);
});
it('cancels only through cancel(), with a distinguishable reason; unknown runs report false', async () => {
  const coordinator = new LocalRunCoordinator();
  let reason: string | null = null;
  const done = coordinator.admit('alice', 'a').launch('run', signal => new Promise<void>(resolve => {
    const stop = () => { reason = stopReason(signal); resolve(); };
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop);
  }));
  expect(coordinator.isActive('run')).toBe(true);
  expect(coordinator.cancel('other')).toBe(false);
  expect(coordinator.cancel('run')).toBe(true);
  await done;
  expect(reason).toBe('cancelled');
  expect(coordinator.isActive('run')).toBe(false);
  expect(coordinator.cancel('run')).toBe(false);
});
it('aborts at the wall-clock limit without releasing a still-running run', async () => {
  vi.useFakeTimers();
  try {
    const coordinator = new LocalRunCoordinator(1, 1, 100);
    let finish!: () => void; let reason: string | null = null;
    const done = coordinator.admit('alice', 'a').launch('r', signal => new Promise<void>(resolve => { finish = resolve; signal.addEventListener('abort', () => { reason = stopReason(signal); }); }));
    await vi.advanceTimersByTimeAsync(100);
    expect(reason).toBe('timeout');
    expect(() => coordinator.admit('alice', 'a')).toThrow(expect.objectContaining({ status: 409 }));
    finish(); await done;
    expect(coordinator.activeCount).toBe(0);
  } finally { vi.useRealTimers(); }
});
