import { afterEach, expect, it, vi } from 'vitest';
import { createRetry } from '../retry.js';
import { createScheduler } from './direct-client-helpers.js';

afterEach(() => vi.useRealTimers());

it('uses capped exponential jitter from the supplied failure count', () => {
  const scheduler = createScheduler();
  const retry = createRetry({
    initialDelayMs: 100,
    maxDelayMs: 250,
    factor: 2,
    random: () => 0.5,
    scheduler,
  });
  const callback = vi.fn();

  retry.schedule(1, callback);
  retry.schedule(2, callback);
  retry.schedule(5, callback);

  expect(scheduler.tasks.map(({ delayMs }) => delayMs)).toEqual([50, 100, 125]);
});

it('keeps a zero-delay callback asynchronous', async () => {
  vi.useFakeTimers();
  const retry = createRetry({ initialDelayMs: 1, random: () => 0 });
  const callback = vi.fn();

  retry.schedule(1, callback);

  expect(callback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(callback).toHaveBeenCalledOnce();
});

it('ignores a callback that was queued before cancellation', () => {
  const scheduler = createScheduler();
  const retry = createRetry({ scheduler, random: () => 0.5 });
  const callback = vi.fn();
  const cancel = retry.schedule(1, callback);

  cancel();
  cancel();
  scheduler.fire(scheduler.tasks[0]);

  expect(scheduler.tasks[0].cleared).toBe(true);
  expect(callback).not.toHaveBeenCalled();
});

it.each([
  [
    'throws',
    () => {
      throw new Error('random failed');
    },
  ],
  ['returns an invalid draw', () => 1],
])('reports a random source that %s', (_label, random) => {
  const retry = createRetry({ random });
  expect(() => retry.schedule(1, () => {})).toThrow();
});

it('reports scheduler failures to the caller', () => {
  const cause = new Error('timer failed');
  const retry = createRetry({
    random: () => 0.5,
    scheduler: {
      setTimeout() {
        throw cause;
      },
      clearTimeout() {},
    },
  });

  expect(() => retry.schedule(1, () => {})).toThrow(cause);
});
