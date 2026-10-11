import { expect, it, vi } from 'vitest';
import { IdleWatchdog } from '../index.js';
import { createScheduler } from './scheduler.js';

it('draws the duration only when armed and replaces the previous window', () => {
  const scheduler = createScheduler();
  const idleMs = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200);
  const idle = vi.fn();
  const watchdog = new IdleWatchdog({ idleMs, scheduler });
  watchdog.onIdle(idle);
  expect(idleMs).not.toHaveBeenCalled();
  watchdog.arm();
  scheduler.advance(50);
  watchdog.arm();
  scheduler.advance(199);
  expect(idle).not.toHaveBeenCalled();
  scheduler.advance(1);
  expect(idle).toHaveBeenCalledOnce();
  watchdog.stop();
});

it('rejects an invalid draw without scheduling a hot timer', () => {
  const scheduler = createScheduler();
  const watchdog = new IdleWatchdog({ idleMs: () => 0, scheduler });
  expect(() => watchdog.arm()).toThrow(RangeError);
  expect(scheduler.pending()).toBe(0);
});

it('does not arm after the duration source stops or cancels the watchdog', () => {
  for (const action of ['stop', 'cancel']) {
    const scheduler = createScheduler();
    const watchdog = new IdleWatchdog({
      idleMs: () => {
        watchdog[action]();
        return 100;
      },
      scheduler,
    });
    watchdog.arm();
    expect(scheduler.pending()).toBe(0);
  }
});
