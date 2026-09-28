import { describe, expect, it } from 'vitest';
import { deferred, setup } from './helpers.js';

describe('Keepalive promise probes', () => {
  it('arms the deadline and passes a fresh signal before invoking the probe', async () => {
    const { keepalive, scheduler, probe, rounds } = setup();
    const observations = [];
    const operation = probe.getMockImplementation();
    probe.mockImplementation((signal) => {
      observations.push(scheduler.pending());
      keepalive.probeNow();
      keepalive.activity();
      keepalive.start();
      return operation(signal);
    });
    keepalive.start();
    keepalive.probeNow();
    expect(observations).toEqual([1]);
    expect(rounds[0].signal).toBeInstanceOf(AbortSignal);
    expect(rounds[0].signal.aborted).toBe(false);
    rounds[0].resolve();
    await rounds[0].promise;
    keepalive.probeNow();
    expect(observations).toEqual([1, 1]);
    expect(rounds[1].signal).not.toBe(rounds[0].signal);
    keepalive.stop();
    expect(rounds[0].signal.aborted).toBe(false);
    expect(rounds[1].signal.aborted).toBe(true);
  });

  it('coalesces probes and activity without moving the deadline', () => {
    const { keepalive, scheduler, probe, failures } = setup();
    keepalive.start();
    keepalive.probeNow();
    scheduler.advance(60);
    keepalive.probeNow();
    keepalive.activity();
    keepalive.start();
    expect(probe).toHaveBeenCalledTimes(1);
    scheduler.advance(39);
    expect(failures).toEqual([]);
    scheduler.advance(1);
    expect(failures).toEqual([{ type: 'timeout' }]);
    expect(scheduler.pending()).toBe(0);
  });

  it('accepts an already fulfilled promise without recursively starting another probe', async () => {
    const { keepalive, scheduler, probe, failures } = setup();
    probe.mockImplementation(() => {
      keepalive.probeNow();
      return Promise.resolve();
    });
    keepalive.start();
    keepalive.probeNow();
    keepalive.probeNow();
    expect(probe).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(scheduler.pending()).toBe(1);
    scheduler.advance(999);
    expect(probe).toHaveBeenCalledTimes(1);
    scheduler.advance(1);
    expect(probe).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(failures).toEqual([]);
    keepalive.stop();
  });

  it('clears the fulfilled deadline and ignores its queued callback during another round', async () => {
    const { keepalive, scheduler, failures, probe, rounds } = setup();
    keepalive.start(); // idle handle 0
    keepalive.probeNow(); // deadline handle 1
    rounds[0].resolve();
    await rounds[0].promise; // idle handle 2
    scheduler.fireQueued(1);
    scheduler.fireQueued(0);
    expect(probe).toHaveBeenCalledTimes(1);
    keepalive.probeNow(); // deadline handle 3
    scheduler.fireQueued(1);
    expect(scheduler.pending()).toBe(1);
    expect(failures).toEqual([]);
    scheduler.advance(100);
    expect(failures).toEqual([{ type: 'timeout' }]);
  });

  it('leaves response matching and validation to the consumer', async () => {
    const response = deferred();
    const invalid = new Error('invalid response');
    const { keepalive, failures } = setup({
      probe: async () => {
        const packet = await response.promise;
        if (packet.type !== 'pong' || packet.id !== 7) throw invalid;
      },
    });
    keepalive.start();
    keepalive.probeNow();
    response.resolve({ type: 'pong', id: 6 });
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toEqual([{ type: 'error', error: invalid }]);
  });
});
