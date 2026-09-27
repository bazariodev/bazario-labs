import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdleWatchdog } from '../index.js';
import { createScheduler } from './scheduler.js';

function setup(options = {}) {
  const scheduler = createScheduler();
  const watchdog = new IdleWatchdog({ idleMs: 100, scheduler, ...options });
  const listener = vi.fn();
  watchdog.onIdle(listener);
  return { scheduler, watchdog, listener };
}

describe('IdleWatchdog', () => {
  afterEach(() => vi.useRealTimers());

  it('starts inert, then emits once per arm', () => {
    const { scheduler, watchdog, listener } = setup();
    expect(scheduler.pending()).toBe(0);
    scheduler.advance(500);
    expect(listener).not.toHaveBeenCalled();
    watchdog.arm();
    expect(scheduler.pending()).toBe(1);
    scheduler.advance(99);
    expect(listener).not.toHaveBeenCalled();
    scheduler.advance(1);
    expect(listener).toHaveBeenCalledExactlyOnceWith();
    expect(scheduler.pending()).toBe(0);
    scheduler.advance(500);
    scheduler.fireQueued(0);
    expect(listener).toHaveBeenCalledTimes(1);
    watchdog.arm();
    scheduler.advance(100);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('moves the deadline and ignores superseded queued callbacks', () => {
    const { scheduler, watchdog, listener } = setup();
    watchdog.arm();
    scheduler.advance(60);
    watchdog.arm();
    expect(scheduler.pending()).toBe(1);
    scheduler.fireQueued(0);
    scheduler.advance(40);
    expect(listener).not.toHaveBeenCalled();
    scheduler.advance(60);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cancels idempotently and can be armed again', () => {
    const { scheduler, watchdog, listener } = setup();
    watchdog.cancel();
    watchdog.arm();
    watchdog.cancel();
    watchdog.cancel();
    expect(scheduler.pending()).toBe(0);
    scheduler.fireQueued(0);
    scheduler.advance(100);
    expect(listener).not.toHaveBeenCalled();
    watchdog.arm();
    scheduler.fireQueued(0);
    scheduler.advance(100);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deduplicates listeners and makes unsubscribe idempotent', () => {
    const { scheduler, watchdog } = setup();
    const calls = [];
    const first = () => calls.push('first');
    const second = () => calls.push('second');
    const unsubscribe = watchdog.onIdle(first);
    watchdog.onIdle(second);
    watchdog.onIdle(first);
    watchdog.arm();
    scheduler.advance(100);
    expect(calls).toEqual(['first', 'second']);
    unsubscribe();
    unsubscribe();
    watchdog.arm();
    scheduler.advance(100);
    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('keeps stale duplicate unsubscribes from removing a later registration', () => {
    const { scheduler, watchdog } = setup();
    const listener = vi.fn();
    const first = watchdog.onIdle(listener);
    const duplicate = watchdog.onIdle(listener);
    first();
    const current = watchdog.onIdle(listener);
    duplicate();
    first();
    duplicate();
    watchdog.arm();
    scheduler.advance(100);
    expect(listener).toHaveBeenCalledTimes(1);
    current();
    watchdog.arm();
    scheduler.advance(100);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('uses a subscriber snapshot during delivery', () => {
    const { scheduler, watchdog } = setup();
    const calls = [];
    const late = () => calls.push('late');
    watchdog.onIdle(() => {
      calls.push('first');
      unsubscribe();
      watchdog.onIdle(late);
    });
    const unsubscribe = watchdog.onIdle(() => calls.push('second'));
    watchdog.arm();
    scheduler.advance(100);
    expect(calls).toEqual(['first', 'second']);
    watchdog.arm();
    scheduler.advance(100);
    expect(calls).toEqual(['first', 'second', 'first', 'late']);
  });

  it('logs a throwing listener and continues delivery', () => {
    const logger = { error: vi.fn() };
    const { scheduler, watchdog } = setup({ logger });
    const error = new Error('subscriber failure');
    watchdog.onIdle(() => {
      throw error;
    });
    const later = vi.fn();
    watchdog.onIdle(later);
    watchdog.arm();
    expect(() => scheduler.advance(100)).not.toThrow();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'IdleWatchdog idle listener threw.',
      error,
    );
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('isolates listener failures with the default no-op logger', () => {
    const { scheduler, watchdog } = setup();
    watchdog.onIdle(() => {
      throw new Error('subscriber failure');
    });
    const later = vi.fn();
    watchdog.onIdle(later);
    watchdog.arm();
    expect(() => scheduler.advance(100)).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('disarms before delivery and preserves a re-entrant arm', () => {
    const { scheduler, watchdog, listener } = setup();
    watchdog.onIdle(() => {
      watchdog.arm();
    });
    watchdog.arm();
    scheduler.advance(100);
    expect(scheduler.pending()).toBe(1);
    scheduler.fireQueued(0);
    expect(listener).toHaveBeenCalledTimes(1);
    scheduler.advance(100);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each([
    'stop',
    Symbol.dispose,
  ])('makes %s terminal and idempotent', (method) => {
    const { scheduler, watchdog, listener } = setup();
    watchdog.arm();
    watchdog[method]();
    watchdog[method]();
    expect(scheduler.pending()).toBe(0);
    watchdog.arm();
    expect(scheduler.pending()).toBe(0);
    watchdog.cancel();
    watchdog.onIdle(listener)();
    scheduler.fireQueued(0);
    scheduler.advance(1000);
    expect(scheduler.pending()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('can stop before the first arm', () => {
    const { scheduler, watchdog, listener } = setup();
    watchdog.stop();
    watchdog.arm();
    expect(scheduler.pending()).toBe(0);
    scheduler.advance(100);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops remaining delivery and cancels a timer armed by a subscriber', () => {
    const { scheduler, watchdog } = setup();
    watchdog.onIdle(() => {
      watchdog.arm();
      watchdog.stop();
    });
    const later = vi.fn();
    watchdog.onIdle(later);
    watchdog.arm();
    scheduler.advance(1000);
    expect(scheduler.pending()).toBe(0);
    scheduler.fireQueued(1);
    expect(later).not.toHaveBeenCalled();
  });

  it('guards callback identity when scheduler handles are reused', () => {
    const callbacks = [];
    const scheduler = {
      setTimeout(callback) {
        callbacks.push(callback);
        return 0;
      },
      clearTimeout: vi.fn(),
    };
    const { watchdog, listener } = setup({ scheduler });
    watchdog.arm();
    watchdog.arm();
    callbacks[0]();
    expect(listener).not.toHaveBeenCalled();
    callbacks[1]();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(scheduler.clearTimeout).toHaveBeenCalledExactlyOnceWith(0);
  });

  it.each([
    undefined,
    null,
    0,
    { id: 1 },
  ])('clears the opaque handle %s', (handle) => {
    const scheduler = {
      setTimeout: () => handle,
      clearTimeout: vi.fn(),
    };
    const { watchdog } = setup({ scheduler });
    watchdog.arm();
    watchdog.cancel();
    watchdog.cancel();
    expect(scheduler.clearTimeout).toHaveBeenCalledExactlyOnceWith(handle);
  });

  it.each([
    0,
    -1,
    0.5,
    1.5,
    2_147_483_646.5,
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    null,
    '100',
  ])('rejects idleMs %s', (idleMs) => {
    expect(() => new IdleWatchdog({ idleMs })).toThrow(RangeError);
    const scheduler = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
    expect(() => new IdleWatchdog({ idleMs, scheduler })).toThrow(
      new RangeError('idleMs must be an integer between 1 and 2147483647.'),
    );
    expect(scheduler.setTimeout).not.toHaveBeenCalled();
    expect(scheduler.clearTimeout).not.toHaveBeenCalled();
  });

  it.each([
    1, 2_147_483_647,
  ])('preserves boundary duration %s with either scheduler', (idleMs) => {
    vi.useFakeTimers();
    const injected = setup({ idleMs });
    const platform = setup({ idleMs, scheduler: undefined });
    injected.watchdog.arm();
    platform.watchdog.arm();
    injected.scheduler.advance(idleMs - 1);
    vi.advanceTimersByTime(idleMs - 1);
    expect(injected.listener).not.toHaveBeenCalled();
    expect(platform.listener).not.toHaveBeenCalled();
    injected.scheduler.advance(1);
    vi.advanceTimersByTime(1);
    expect(injected.listener).toHaveBeenCalledTimes(1);
    expect(platform.listener).toHaveBeenCalledTimes(1);
    expect(injected.scheduler.pending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the platform scheduler by default', () => {
    vi.useFakeTimers();
    const watchdog = new IdleWatchdog({ idleMs: 100 });
    const listener = vi.fn();
    watchdog.onIdle(listener);
    expect(vi.getTimerCount()).toBe(0);
    watchdog.arm();
    vi.advanceTimersByTime(60);
    watchdog.arm();
    vi.advanceTimersByTime(99);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    watchdog.arm();
    watchdog[Symbol.dispose]();
    expect(vi.getTimerCount()).toBe(0);
  });
});
