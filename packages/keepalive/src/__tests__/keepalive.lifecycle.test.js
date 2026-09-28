import { describe, expect, it, vi } from 'vitest';
import { Keepalive } from '../index.js';
import { setup } from './helpers.js';
import { createScheduler } from './scheduler.js';

describe('Keepalive lifecycle and failure subscriptions', () => {
  it('is inert until explicitly started', () => {
    const { keepalive, scheduler, probe, failures } = setup();
    keepalive.activity();
    expect(scheduler.pending()).toBe(0);
    keepalive.probeNow();
    scheduler.advance(10000);
    expect(scheduler.pending()).toBe(0);
    expect(probe).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  it.each([
    'stop',
    Symbol.dispose,
  ])('makes %s silent, terminal, and idempotent', async (method) => {
    const { keepalive, scheduler, probe, rounds, failures } = setup();
    keepalive.start();
    keepalive.probeNow();
    const onAbort = vi.fn();
    rounds[0].signal.addEventListener('abort', onAbort);
    keepalive[method]();
    keepalive[method]();
    keepalive.start();
    keepalive.activity();
    keepalive.probeNow();
    expect(scheduler.pending()).toBe(0);
    expect(onAbort).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    keepalive.onFail(late)();
    scheduler.fireQueued(0);
    scheduler.fireQueued(1);
    rounds[0].reject(new Error('cancelled'));
    await Promise.resolve();
    scheduler.advance(10000);
    expect(late).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
  });

  it.each([
    false,
    true,
  ])('can stop before a probe with started=%s', (started) => {
    const { keepalive, scheduler, probe } = setup();
    if (started) keepalive.start();
    keepalive.stop();
    keepalive.start();
    keepalive.probeNow();
    expect(scheduler.pending()).toBe(0);
    if (started) scheduler.fireQueued(0);
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    'resolve',
    'reject',
    'throw',
  ])('honors stop inside a probe that will %s', async (settle) => {
    const { keepalive, scheduler, probe, failures } = setup();
    let signal;
    probe.mockImplementation((received) => {
      signal = received;
      keepalive.stop();
      if (settle === 'throw') throw new Error('stopped');
      return Promise[settle]();
    });
    keepalive.start();
    keepalive.probeNow();
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(scheduler.pending()).toBe(0);
    expect(failures).toEqual([]);
  });

  it('ignores late fulfillment after stop', async () => {
    const { keepalive, scheduler, rounds, failures } = setup();
    keepalive.start();
    keepalive.probeNow();
    keepalive.stop();
    rounds[0].resolve();
    await rounds[0].promise;
    expect(scheduler.pending()).toBe(0);
    expect(failures).toEqual([]);
  });

  it('does not let abort callbacks restart the monitor', async () => {
    const { keepalive, scheduler, probe, failures } = setup();
    probe.mockImplementation(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              keepalive.start();
              keepalive.probeNow();
              keepalive.activity();
              resolve();
            },
            { once: true },
          );
        }),
    );
    keepalive.start();
    keepalive.probeNow();
    scheduler.advance(100);
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(0);
    expect(failures).toEqual([{ type: 'timeout' }]);
  });

  it('delivers the failure even when abort cleanup stops and unsubscribes', () => {
    const { keepalive, scheduler, rounds, failures } = setup();
    keepalive.start();
    keepalive.probeNow();
    const observer = vi.fn();
    const unsubscribe = keepalive.onFail(observer);
    rounds[0].signal.addEventListener('abort', () => {
      keepalive.stop();
      unsubscribe();
    });
    scheduler.advance(100);
    expect(failures).toEqual([{ type: 'timeout' }]);
    expect(observer).toHaveBeenCalledExactlyOnceWith({ type: 'timeout' });
    expect(scheduler.pending()).toBe(0);
  });

  it('deduplicates listeners without reordering', () => {
    const { keepalive, scheduler } = setup();
    const calls = [];
    const first = () => calls.push('first');
    keepalive.onFail(first);
    keepalive.onFail(() => calls.push('second'));
    keepalive.onFail(first);
    keepalive.start();
    scheduler.advance(1100);
    expect(calls).toEqual(['first', 'second']);
  });

  it('duplicate unsubscribe handles cannot remove a later registration', () => {
    const { keepalive, scheduler } = setup();
    const listener = vi.fn();
    const old = keepalive.onFail(listener);
    const duplicate = keepalive.onFail(listener);
    duplicate();
    keepalive.onFail(listener);
    old();
    duplicate();
    keepalive.start();
    scheduler.advance(1100);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes idempotently before failure', () => {
    const { keepalive, scheduler } = setup();
    const listener = vi.fn();
    const unsubscribe = keepalive.onFail(listener);
    unsubscribe();
    unsubscribe();
    keepalive.start();
    scheduler.advance(1100);
    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers a snapshot while new subscriptions are inert after failure', () => {
    const { keepalive, scheduler } = setup();
    const calls = [];
    const late = vi.fn();
    keepalive.onFail(() => {
      calls.push('first');
      unsubscribe();
      keepalive.onFail(late);
    });
    const unsubscribe = keepalive.onFail(() => calls.push('second'));
    keepalive.start();
    scheduler.advance(1100);
    expect(calls).toEqual(['first', 'second']);
    expect(late).not.toHaveBeenCalled();
  });

  it('delivers the failure to observers after the owner stops the monitor', () => {
    const { keepalive, scheduler } = setup();
    keepalive.onFail(() => keepalive.stop());
    const later = vi.fn();
    keepalive.onFail(later);
    keepalive.start();
    scheduler.advance(1100);
    expect(later).toHaveBeenCalledExactlyOnceWith({ type: 'timeout' });
  });

  it('logs the original listener error and continues delivery', () => {
    const { keepalive, scheduler, logger } = setup();
    const error = new Error('recovery failed');
    keepalive.onFail(() => {
      throw error;
    });
    const later = vi.fn();
    keepalive.onFail(later);
    keepalive.start();
    scheduler.advance(1100);
    expect(later).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Keepalive failure listener threw.',
      error,
    );
    expect(scheduler.pending()).toBe(0);
  });

  it('isolates listeners with the default no-op logger', () => {
    const scheduler = createScheduler();
    const keepalive = new Keepalive({
      idleMs: 1000,
      deadlineMs: 100,
      probe: () => new Promise(() => {}),
      scheduler,
    });
    keepalive.onFail(() => {
      throw new Error('listener');
    });
    const later = vi.fn();
    keepalive.onFail(later);
    keepalive.start();
    expect(() => scheduler.advance(1100)).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('keeps instances independent on the same scheduler', async () => {
    const scheduler = createScheduler();
    const first = setup({ scheduler });
    const second = setup({ scheduler, idleMs: 2000 });
    first.keepalive.start();
    second.keepalive.start();
    scheduler.advance(1100);
    expect(first.failures).toHaveLength(1);
    expect(second.probe).not.toHaveBeenCalled();
    scheduler.advance(900);
    expect(second.probe).toHaveBeenCalledTimes(1);
    second.rounds[0].resolve();
    await second.rounds[0].promise;
    second.keepalive.stop();
    expect(scheduler.pending()).toBe(0);
  });
});
