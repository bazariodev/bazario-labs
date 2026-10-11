import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keepalive } from '../index.js';
import { deferred, setup } from './helpers.js';

describe('Keepalive configuration and timer ports', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    'idleMs',
    'deadlineMs',
  ])('delegates %s validation without rounding or clamping', (name) => {
    const options = {
      idleMs: 1000,
      deadlineMs: 100,
      probe: vi.fn(),
      [name]: 0.5,
    };
    const scheduler = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
    expect(() => new Keepalive(options)).toThrow(RangeError);
    expect(() => new Keepalive({ ...options, scheduler })).toThrow(RangeError);
    expect(scheduler.setTimeout).not.toHaveBeenCalled();
    expect(scheduler.clearTimeout).not.toHaveBeenCalled();
    expect(options.probe).not.toHaveBeenCalled();
  });

  it('clears platform deadlines on fulfillment and disposal', async () => {
    vi.useFakeTimers();
    const round = deferred();
    const keepalive = new Keepalive({
      idleMs: 1000,
      deadlineMs: 100,
      probe: () => round.promise,
    });
    expect(vi.getTimerCount()).toBe(0);
    keepalive.start();
    expect(vi.getTimerCount()).toBe(1);
    keepalive.probeNow();
    expect(vi.getTimerCount()).toBe(1);
    round.resolve();
    await round.promise;
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    keepalive[Symbol.dispose]();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    undefined,
    null,
    false,
    {},
  ])('rejects a non-callable probe %s', (probe) => {
    expect(() => setup({ probe })).toThrow(TypeError);
  });

  it.each([
    undefined,
    null,
    false,
    {},
  ])('rejects a non-promise probe result %s and aborts the operation', (result) => {
    let signal;
    const { keepalive, scheduler, failures } = setup({
      probe(received) {
        signal = received;
        return result;
      },
    });
    keepalive.start();
    keepalive.probeNow();
    expect(failures).toEqual([{ type: 'error', error: expect.any(TypeError) }]);
    expect(signal.aborted).toBe(true);
    expect(scheduler.pending()).toBe(0);
    scheduler.fireQueued(1);
    expect(failures).toHaveLength(1);
  });

  it('fails a forgotten return even if the discarded promise fulfills', async () => {
    const response = deferred();
    let signal;
    const { keepalive, scheduler, failures } = setup({
      probe(received) {
        signal = received;
        response.promise.then(() => {});
      },
    });
    keepalive.start();
    keepalive.probeNow();
    expect(failures).toEqual([{ type: 'error', error: expect.any(TypeError) }]);
    expect(signal.aborted).toBe(true);
    response.resolve();
    await response.promise;
    scheduler.advance(10000);
    expect(scheduler.pending()).toBe(0);
    expect(failures).toHaveLength(1);
  });
});
