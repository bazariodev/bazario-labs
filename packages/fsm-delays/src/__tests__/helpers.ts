import { Fsm, type Logger } from '@bazariodev/fsm';
import { vi } from 'vitest';

import type { Scheduler } from '../types.js';

export type State =
  | 'idle'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export type Event =
  | { type: 'CALL' }
  | { type: 'ANSWER' }
  | { type: 'NO_ANSWER' }
  | { type: 'PING' }
  | { type: 'HANGUP' }
  | { type: 'DROP' }
  | { type: 'RETRY' }
  | { type: 'RESET' };

export type Context = { pings: number; attempts: number };

export const createMachine = (
  initial: State = 'idle',
  context: Context = { pings: 0, attempts: 0 },
): Fsm<State, Event, Context> =>
  new Fsm<State, Event, Context>({
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

export const createLogger = (): Logger => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

type Timer = { at: number; cb: () => void; interval: number | null };

export type StubScheduler = Scheduler & {
  advance: (ms: number) => void;
  pending: () => number;
};

/**
 * Deterministic in-memory clock. `advance(ms)` fires every due timer in time
 * order, re-scanning after each callback so a transition that arms or clears
 * timers mid-advance is reflected immediately.
 */
export const createStubScheduler = (): StubScheduler => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();

  const arm = (cb: () => void, ms: number, interval: number | null): number => {
    const id = nextId++;
    timers.set(id, { at: now + ms, cb, interval });
    return id;
  };

  const advance = (ms: number): void => {
    const target = now + ms;
    while (true) {
      let dueId: number | null = null;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueId = id;
          dueAt = timer.at;
        }
      }
      if (dueId === null) break;

      const timer = timers.get(dueId) as Timer;
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
      timers.delete(handle as number);
    },
    setInterval: (cb, ms) => arm(cb, ms, ms),
    clearInterval: (handle) => {
      timers.delete(handle as number);
    },
    advance,
    pending: () => timers.size,
  };
};
