import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackoffScheduler, defaultScheduler } from '../index.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeTimer() {
  const jobs = [];
  return {
    jobs,
    setTimeout(callback, delayMs) {
      const job = { callback, delayMs, cleared: false };
      jobs.push(job);
      return job;
    },
    clearTimeout(job) {
      job.cleared = true;
    },
  };
}

describe('createBackoffScheduler', () => {
  it('does not schedule work during construction', () => {
    const timer = makeTimer();

    createBackoffScheduler({ scheduler: timer });

    expect(timer.jobs).toEqual([]);
  });

  it('keeps the default delays and asynchronous zero-delay callbacks', async () => {
    const timer = makeTimer();
    const defaults = createBackoffScheduler({
      scheduler: timer,
      jitter: { random: () => 0.5 },
    });
    defaults.schedule(1, () => {});
    defaults.schedule(2, () => {});
    defaults.schedule(20, () => {});
    expect(timer.jobs.map(({ delayMs }) => delayMs)).toEqual([
      250, 500, 15_000,
    ]);

    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const backoff = createBackoffScheduler({ jitter: { random: () => 0 } });
      backoff.schedule(1, callback);
      expect(callback).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a zero-delay callback through the default provider', async () => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const backoff = createBackoffScheduler({ jitter: { random: () => 0 } });
      const cancel = backoff.schedule(1, callback);
      cancel();
      await vi.runOnlyPendingTimersAsync();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses one-based attempts, full jitter, and the capped exponential base', () => {
    const timer = makeTimer();
    const random = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.75);
    const backoff = createBackoffScheduler({
      initialDelayMs: 100,
      maxDelayMs: 250,
      scheduler: timer,
      jitter: { random },
    });

    backoff.schedule(1, () => {});
    backoff.schedule(3, () => {});

    expect(timer.jobs.map(({ delayMs }) => delayMs)).toEqual([50, 187]);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('supports disabled jitter, fixed ratios, and ratios above one', () => {
    const timer = makeTimer();
    const random = vi.fn(() => 0.5);
    const nativeRandom = vi.spyOn(Math, 'random');
    const backoff = createBackoffScheduler({
      initialDelayMs: 100,
      maxDelayMs: 150,
      scheduler: timer,
      jitter: { minRatio: 2, maxRatio: 2, random },
    });

    backoff.schedule(1, () => {});
    const unjittered = createBackoffScheduler({
      initialDelayMs: 100,
      maxDelayMs: 150,
      scheduler: timer,
      jitter: false,
    });
    unjittered.schedule(2, () => {});

    expect(timer.jobs.map(({ delayMs }) => delayMs)).toEqual([150, 150]);
    expect(random).not.toHaveBeenCalled();
    expect(nativeRandom).not.toHaveBeenCalled();
  });

  it('samples within configured ratios and floors the final delay', () => {
    const timer = makeTimer();
    const backoff = createBackoffScheduler({
      initialDelayMs: 100,
      maxDelayMs: 500,
      scheduler: timer,
      jitter: { minRatio: 0.25, maxRatio: 0.75, random: () => 0.51 },
    });

    backoff.schedule(1, () => {});

    expect(timer.jobs[0].delayMs).toBe(50);
  });

  it('keeps jobs independent and makes cancellation idempotent', () => {
    const timer = makeTimer();
    const backoff = createBackoffScheduler({ scheduler: timer });
    const callback = vi.fn();

    const cancel = backoff.schedule(1, callback);
    backoff.schedule(1, callback);
    cancel();
    cancel();
    timer.jobs[0].callback();
    timer.jobs[1].callback();
    timer.jobs[1].callback();

    expect(timer.jobs[0].cleared).toBe(true);
    expect(timer.jobs[1].cleared).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not clear a completed timer and allows callback reentry', () => {
    const timer = makeTimer();
    const backoff = createBackoffScheduler({ scheduler: timer });
    const nested = vi.fn();
    const callback = vi.fn(() => backoff.schedule(2, nested));
    const cancel = backoff.schedule(1, callback);

    timer.jobs[0].callback();
    cancel();

    expect(timer.jobs[0].cleared).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
    expect(timer.jobs).toHaveLength(2);
    timer.jobs[1].callback();
    expect(nested).toHaveBeenCalledOnce();
  });

  it('propagates random and timer-provider failures', () => {
    const randomError = new Error('random failed');
    const timerError = new Error('timer failed');
    const clearError = new Error('clear failed');
    let scheduledCallback;
    const randomFailure = createBackoffScheduler({
      jitter: {
        random: () => {
          throw randomError;
        },
      },
    });
    const timerFailure = createBackoffScheduler({
      scheduler: {
        setTimeout() {
          throw timerError;
        },
        clearTimeout() {},
      },
    });
    const clearFailure = createBackoffScheduler({
      scheduler: {
        setTimeout(callback) {
          scheduledCallback = callback;
          return callback;
        },
        clearTimeout() {
          throw clearError;
        },
      },
    });

    expect(() => randomFailure.schedule(1, () => {})).toThrow(randomError);
    expect(() => timerFailure.schedule(1, () => {})).toThrow(timerError);
    const callback = vi.fn();
    const cancel = clearFailure.schedule(1, callback);
    expect(cancel).toThrow(clearError);
    scheduledCallback();
    expect(callback).not.toHaveBeenCalled();
    expect(() => cancel()).not.toThrow();
  });

  it('forwards default timer calls to the current globals', () => {
    const setTimeout = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(17);
    const clearTimeout = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => {});
    const callback = vi.fn();

    const handle = defaultScheduler.setTimeout(callback, 0);
    defaultScheduler.clearTimeout(handle);

    expect(setTimeout).toHaveBeenCalledWith(callback, 0);
    expect(clearTimeout).toHaveBeenCalledWith(17);
    setTimeout.mockRestore();
    clearTimeout.mockRestore();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
  ])('rejects invalid attempts: %s', (attempt) => {
    const backoff = createBackoffScheduler({ scheduler: makeTimer() });
    expect(() => backoff.schedule(attempt, () => {})).toThrow(RangeError);
  });

  it('rejects invalid configuration and random results', () => {
    expect(() => createBackoffScheduler({ initialDelayMs: 0 })).toThrow(
      RangeError,
    );
    expect(() => createBackoffScheduler({ maxDelayMs: 499 })).toThrow(
      RangeError,
    );
    expect(() => createBackoffScheduler({ maxDelayMs: 2_147_483_648 })).toThrow(
      RangeError,
    );
    expect(() => createBackoffScheduler({ factor: 0.5 })).toThrow(RangeError);
    expect(() =>
      createBackoffScheduler({ factor: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => createBackoffScheduler({ scheduler: {} })).toThrow(TypeError);
    expect(() =>
      createBackoffScheduler({ jitter: { minRatio: 2, maxRatio: 1 } }),
    ).toThrow(RangeError);
    expect(() => createBackoffScheduler({ jitter: { minRatio: -1 } })).toThrow(
      RangeError,
    );
    expect(() =>
      createBackoffScheduler({
        jitter: { minRatio: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(RangeError);
    expect(() => createBackoffScheduler({ jitter: null })).toThrow(TypeError);
    expect(() => createBackoffScheduler({ jitter: { random: 1 } })).toThrow(
      TypeError,
    );

    for (const value of [Number.NaN, -0.1, 1, Number.POSITIVE_INFINITY]) {
      const backoff = createBackoffScheduler({
        scheduler: makeTimer(),
        jitter: { random: () => value },
      });
      expect(() => backoff.schedule(1, () => {})).toThrow(RangeError);
    }

    const backoff = createBackoffScheduler({ scheduler: makeTimer() });
    expect(() => backoff.schedule(1, null)).toThrow(TypeError);
  });
});
