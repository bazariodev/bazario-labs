import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

describe('Keepalive terminal failures', () => {
  it.each([
    'throw',
    'reject',
  ])('contains a probe that will %s and preserves its cause', async (mode) => {
    const { keepalive, probe, scheduler, failures, logger } = setup();
    const error = new Error('private request');
    let signal;
    probe.mockImplementation((received) => {
      signal = received;
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    });
    keepalive.start();
    keepalive.probeNow();
    await Promise.resolve();
    expect(failures).toEqual([{ type: 'error', error }]);
    expect(signal.aborted).toBe(true);
    expect(scheduler.pending()).toBe(0);
    keepalive.start();
    keepalive.probeNow();
    keepalive.activity();
    scheduler.advance(10000);
    scheduler.fireQueued(0);
    scheduler.fireQueued(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    'throw',
    'reject',
  ])('reports undefined from %s as an error', async (mode) => {
    const { keepalive, probe, failures, scheduler } = setup();
    probe.mockImplementation(() => {
      if (mode === 'throw') throw undefined;
      return Promise.reject();
    });
    keepalive.start();
    keepalive.probeNow();
    await Promise.resolve();
    expect(failures).toEqual([{ type: 'error', error: undefined }]);
    expect(scheduler.pending()).toBe(0);
  });
});
