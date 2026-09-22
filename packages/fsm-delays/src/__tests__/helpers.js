import { Fsm } from '@bazariodev/fsm';
import { vi } from 'vitest';

export const createMachine = (
  initial = 'idle',
  context = { pings: 0, attempts: 0 },
) =>
  new Fsm({
    name: 'delays-test',
    initial,
    context,
    states: {
      idle: {},
      ringing: {},
      connected: {},
      reconnecting: {},
      failed: {},
    },
    transitions: {
      idle: { CALL: { target: 'ringing' } },
      ringing: {
        ANSWER: { target: 'connected' },
        NO_ANSWER: { target: 'failed' },
      },
      connected: {
        PING: {
          target: 'connected',
          reducer: (c) => ({ ...c, pings: c.pings + 1 }),
        },
        DROP: { target: 'reconnecting' },
        HANGUP: { target: 'idle' },
      },
      reconnecting: {
        RETRY: {
          target: 'reconnecting',
          reducer: (c) => ({ ...c, attempts: c.attempts + 1 }),
        },
        ANSWER: { target: 'connected' },
      },
      failed: {},
      '*': { RESET: { target: 'idle' } },
    },
  });

export const createLogger = () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/**
 * Deterministic in-memory clock. `advance(ms)` fires every due timer in time
 * order, re-scanning after each callback so a transition that arms or clears
 * timers mid-advance is reflected immediately.
 */
export const createStubScheduler = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  const arm = (cb, ms, interval) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, cb, interval });
    return id;
  };

  const advance = (ms) => {
    const target = now + ms;
    while (true) {
      let dueId = null;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueId = id;
          dueAt = timer.at;
        }
      }
      if (dueId === null) break;

      const timer = timers.get(dueId);
      now = timer.at;
      if (timer.interval === null) {
        timers.delete(dueId);
      } else {
        timer.at += timer.interval;
      }
      timer.cb();
    }
    now = target;
  };

  return {
    setTimeout: (cb, ms) => arm(cb, ms, null),
    clearTimeout: (handle) => {
      timers.delete(handle);
    },
    setInterval: (cb, ms) => arm(cb, ms, ms),
    clearInterval: (handle) => {
      timers.delete(handle);
    },
    advance,
    pending: () => timers.size,
  };
};
