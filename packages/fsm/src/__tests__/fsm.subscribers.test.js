import { describe, expect, it, vi } from 'vitest';

import { createContext, createLogger, createMachine } from './helpers.js';

describe('Fsm subscriber delivery', () => {
  it('allows subscribers to send nested transitions after commit', () => {
    const deliveries = [];
    const machine = createMachine({
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
          },
        },
        dialing: {
          CONNECT: {
            target: 'connected',
          },
        },
        connected: {},
        failed: {},
        '*': {},
      },
    });

    machine.subscribe((snapshot) => {
      deliveries.push(
        `first:${snapshot.value}:${snapshot.version}:${machine.state}`,
      );

      if (snapshot.value === 'dialing') machine.send({ type: 'CONNECT' });
    });
    machine.subscribe((snapshot) => {
      deliveries.push(
        `second:${snapshot.value}:${snapshot.version}:${machine.state}`,
      );
    });

    machine.send({ type: 'DIAL', destination: '1001' });

    expect(machine.snapshot).toEqual({
      value: 'connected',
      previousValue: 'dialing',
      context: createContext(),
      version: 2,
    });
    expect(deliveries).toEqual([
      'first:dialing:1:dialing',
      'first:connected:2:connected',
      'second:connected:2:connected',
    ]);
  });

  it('uses a stable subscriber list and logs subscriber failures', () => {
    const logger = createLogger();
    const calls = [];
    const boom = new Error('subscriber failed');
    const lateSubscriber = vi.fn(() => calls.push('late'));
    const secondSubscriber = vi.fn(() => calls.push('second'));
    const thirdSubscriber = vi.fn(() => calls.push('third'));
    let unsubscribeSecond = () => undefined;
    let lateSubscribed = false;

    const machine = createMachine({
      logger,
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
    });

    machine.subscribe(() => {
      calls.push('first');
      unsubscribeSecond();

      if (!lateSubscribed) {
        lateSubscribed = true;
        machine.subscribe(lateSubscriber);
      }

      throw boom;
    });
    unsubscribeSecond = machine.subscribe(secondSubscriber);
    machine.subscribe(thirdSubscriber);

    machine.send({ type: 'DIAL', destination: '1001' });

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(secondSubscriber).toHaveBeenCalledTimes(1);
    expect(thirdSubscriber).toHaveBeenCalledTimes(1);
    expect(lateSubscriber).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'fsm: subscriber notification failed',
      expect.objectContaining({
        state: 'dialing',
        version: 1,
        error: boom,
      }),
    );
  });
});
