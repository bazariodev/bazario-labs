import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

describe('Keepalive idle and probe windows', () => {
  it('probes after idleness, then aborts and fails after its deadline', () => {
    const { keepalive, scheduler, probe, rounds, failures } = setup();
    keepalive.start();
    expect(scheduler.pending()).toBe(1);
    scheduler.advance(999);
    expect(probe).not.toHaveBeenCalled();
    scheduler.advance(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(1);
    scheduler.advance(99);
    expect(failures).toEqual([]);
    expect(rounds[0].signal.aborted).toBe(false);
    scheduler.advance(1);
    expect(rounds[0].signal.aborted).toBe(true);
    expect(failures).toEqual([{ type: 'timeout' }]);
    expect(scheduler.pending()).toBe(0);
    scheduler.advance(10000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
  });

  it('activity replaces the idle window and invalidates its old callback', () => {
    const { keepalive, scheduler, probe } = setup();
    keepalive.start();
    scheduler.advance(600);
    keepalive.activity();
    scheduler.fireQueued(0);
    scheduler.advance(999);
    expect(probe).not.toHaveBeenCalled();
    scheduler.advance(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('repeated start does not reset the idle window', () => {
    const { keepalive, scheduler, probe } = setup();
    keepalive.start();
    scheduler.advance(600);
    keepalive.start();
    scheduler.advance(400);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each([
    50, 100, 5000,
  ])('suspends idle monitoring during a probe with idleMs=%s', (idleMs) => {
    const { keepalive, scheduler, probe, failures } = setup({
      idleMs,
    });
    keepalive.start();
    keepalive.probeNow();
    scheduler.advance(60);
    keepalive.activity();
    keepalive.probeNow();
    expect(scheduler.pending()).toBe(1);
    scheduler.advance(40);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([{ type: 'timeout' }]);
    expect(scheduler.pending()).toBe(0);
  });

  it('begins a fresh idle window after each fulfillment', async () => {
    const { keepalive, scheduler, probe, rounds, failures } = setup();
    keepalive.start();
    for (let index = 0; index < 3; index++) {
      scheduler.advance(1000);
      expect(probe).toHaveBeenCalledTimes(index + 1);
      scheduler.advance(60);
      rounds[index].resolve();
      await rounds[index].promise;
      expect(scheduler.pending()).toBe(1);
    }
    expect(failures).toEqual([]);
    keepalive.stop();
  });

  it('is terminal and aborted before failure delivery, even when recovery awaits', async () => {
    const { keepalive, scheduler, probe, rounds, failures } = setup();
    const observations = [];
    keepalive.onFail(async () => {
      observations.push([scheduler.pending(), rounds[0].signal.aborted]);
      keepalive.start();
      keepalive.activity();
      keepalive.probeNow();
      await Promise.resolve();
      keepalive.stop();
    });
    keepalive.start();
    scheduler.advance(1100);
    expect(observations).toEqual([[0, true]]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
    await Promise.resolve();
    scheduler.advance(10000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it.each([
    'resolve',
    'reject',
  ])('ignores a late %s after timeout', async (settle) => {
    const { keepalive, scheduler, probe, rounds, failures } = setup();
    keepalive.start();
    keepalive.probeNow();
    scheduler.advance(100);
    rounds[0][settle](new Error('late result'));
    await Promise.resolve();
    expect(failures).toEqual([{ type: 'timeout' }]);
    expect(scheduler.pending()).toBe(0);
    scheduler.advance(10000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('lets abort-aware requests clean up without a second failure', async () => {
    const { keepalive, scheduler, probe, failures } = setup();
    let pendingRequests = 0;
    probe.mockImplementation(
      (signal) =>
        new Promise((_, reject) => {
          pendingRequests++;
          signal.addEventListener(
            'abort',
            () => {
              pendingRequests--;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const observations = [];
    keepalive.onFail(() => observations.push(pendingRequests));
    keepalive.start();
    keepalive.probeNow();
    expect(pendingRequests).toBe(1);
    scheduler.advance(100);
    await Promise.resolve();
    expect(observations).toEqual([0]);
    expect(failures).toEqual([{ type: 'timeout' }]);
  });
});
