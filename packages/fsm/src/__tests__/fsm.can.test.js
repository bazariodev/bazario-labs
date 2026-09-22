import { describe, expect, it, vi } from 'vitest';

import { createLogger, createMachine } from './helpers.js';

describe('Fsm can', () => {
  it('checks guards with the full event without side effects', () => {
    const reducer = vi.fn((context) => ({
      ...context,
      attempts: context.attempts + 1,
    }));
    const onTransitionStart = vi.fn();
    const onTransitionBeforeCommit = vi.fn();
    const subscriber = vi.fn();
    const machine = createMachine({
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
            guard: (_context, event) =>
              event.type === 'DIAL' && event.destination === '1001',
            reducer,
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
      onTransitionStart,
      onTransitionBeforeCommit,
    });
    const snapshot = machine.snapshot;

    machine.subscribe(subscriber);

    expect(machine.can({ type: 'DIAL', destination: '1001' })).toBe(true);
    expect(machine.can({ type: 'DIAL', destination: '2002' })).toBe(false);
    expect(machine.snapshot).toBe(snapshot);
    expect(reducer).not.toHaveBeenCalled();
    expect(onTransitionStart).not.toHaveBeenCalled();
    expect(onTransitionBeforeCommit).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('logs and rethrows when a guard throws', () => {
    const logger = createLogger();
    const boom = new Error('guard exploded');
    const machine = createMachine({
      logger,
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
            guard: () => {
              throw boom;
            },
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
    });

    expect(() => machine.can({ type: 'DIAL', destination: '1001' })).toThrow(
      boom,
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(machine.state).toBe('idle');
  });
});
