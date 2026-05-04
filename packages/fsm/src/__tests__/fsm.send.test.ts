import { describe, expect, it, vi } from 'vitest';

import type { FsmSnapshot } from '../types.js';
import {
  type CallContext,
  type CallState,
  createContext,
  createLogger,
  createMachine,
  createStates,
} from './helpers.js';

describe('Fsm send', () => {
  it('commits an accepted transition before notifying subscribers', () => {
    const calls: string[] = [];
    const subscriber = vi.fn(
      (snapshot: FsmSnapshot<CallState, CallContext>) => {
        calls.push(
          `subscriber:${snapshot.value}:${snapshot.version}:${snapshot.context.attempts}`,
        );
      },
    );

    const machine = createMachine({
      states: {
        idle: {
          onLeave: (payload) => {
            calls.push(
              `leave:${payload.from}->${payload.to}:${payload.context.attempts}`,
            );
          },
        },
        dialing: {
          onEnter: (payload) => {
            calls.push(
              `enter:${payload.from}->${payload.to}:${payload.context.attempts}`,
            );
          },
        },
        connected: {},
        failed: {},
      },
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
            reducer: (context, event) => ({
              attempts: context.attempts + 1,
              destination:
                event.type === 'DIAL' ? event.destination : context.destination,
              reason: context.reason,
            }),
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
      onTransitionStart: (payload) => {
        calls.push(
          `start:${payload.from}->${payload.to}:${payload.context.attempts}`,
        );
      },
      onTransitionBeforeCommit: (payload) => {
        calls.push(
          `beforeCommit:${payload.previousContext.attempts}->${payload.nextContext.attempts}`,
        );
      },
    });

    const initialSnapshot = machine.snapshot;

    expect(Object.isFrozen(initialSnapshot)).toBe(true);

    machine.subscribe(subscriber);
    machine.send({ type: 'DIAL', destination: '1001' });

    expect(machine.state).toBe('dialing');
    expect(machine.context).toEqual({
      attempts: 1,
      destination: '1001',
      reason: null,
    });
    expect(machine.snapshot).toEqual({
      value: 'dialing',
      previousValue: 'idle',
      context: {
        attempts: 1,
        destination: '1001',
        reason: null,
      },
      version: 1,
    });
    expect(machine.snapshot).not.toBe(initialSnapshot);
    expect(Object.isFrozen(machine.snapshot)).toBe(true);
    expect(calls).toEqual([
      'start:idle->dialing:0',
      'leave:idle->dialing:0',
      'enter:idle->dialing:1',
      'beforeCommit:0->1',
      'subscriber:dialing:1:1',
    ]);
    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('uses the first transition whose guard passes', () => {
    const firstGuard = vi.fn(() => false);
    const secondGuard = vi.fn(() => true);
    const thirdGuard = vi.fn(() => true);
    const machine = createMachine({
      transitions: {
        idle: {
          DIAL: [
            {
              target: 'failed',
              guard: firstGuard,
            },
            {
              target: 'dialing',
              guard: secondGuard,
            },
            {
              target: 'connected',
              guard: thirdGuard,
            },
          ],
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
    });

    machine.send({ type: 'DIAL', destination: '1001' });

    expect(machine.state).toBe('dialing');
    expect(firstGuard).toHaveBeenCalledTimes(1);
    expect(secondGuard).toHaveBeenCalledTimes(1);
    expect(thirdGuard).not.toHaveBeenCalled();
  });

  it('fires only transition hooks for self-transitions', () => {
    const calls: string[] = [];
    const machine = createMachine({
      states: {
        ...createStates(),
        idle: {
          onEnter: () => calls.push('enter'),
          onLeave: () => calls.push('leave'),
        },
      },
      transitions: {
        idle: {
          RESET: {
            target: 'idle',
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
      onTransitionStart: () => calls.push('start'),
      onTransitionBeforeCommit: () => calls.push('beforeCommit'),
    });

    calls.length = 0;

    machine.send({ type: 'RESET' });

    expect(machine.snapshot).toEqual({
      value: 'idle',
      previousValue: 'idle',
      context: createContext(),
      version: 1,
    });
    expect(calls).toEqual(['start', 'beforeCommit']);
  });

  it('rejects guard failures without falling back to wildcard transitions', () => {
    const logger = createLogger();
    const subscriber = vi.fn();
    const machine = createMachine({
      logger,
      transitions: {
        idle: {
          RESET: {
            target: 'connected',
            guard: () => false,
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {
          RESET: {
            target: 'failed',
          },
        },
      },
    });

    machine.subscribe(subscriber);

    expect(machine.can({ type: 'RESET' })).toBe(false);

    machine.send({ type: 'RESET' });

    expect(machine.snapshot).toEqual({
      value: 'idle',
      previousValue: null,
      context: createContext(),
      version: 0,
    });
    expect(subscriber).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'fsm: transition rejected',
      expect.objectContaining({
        state: 'idle',
        eventType: 'RESET',
      }),
    );
  });

  it('rejects unknown events without changing snapshot or notifying subscribers', () => {
    const logger = createLogger();
    const subscriber = vi.fn();
    const machine = createMachine({ logger });
    const snapshot = machine.snapshot;

    machine.subscribe(subscriber);
    machine.send({ type: 'CONNECT' });

    expect(machine.snapshot).toBe(snapshot);
    expect(machine.snapshot.version).toBe(0);
    expect(subscriber).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'fsm: transition rejected',
      expect.objectContaining({
        state: 'idle',
        eventType: 'CONNECT',
      }),
    );
  });

  it('uses wildcard transitions when the current state has no event entry', () => {
    const machine = createMachine({
      transitions: {
        idle: {},
        dialing: {},
        connected: {},
        failed: {},
        '*': {
          FAIL: {
            target: 'failed',
            reducer: (context) => ({
              ...context,
              reason: 'global-failure',
            }),
          },
        },
      },
    });

    expect(machine.can({ type: 'FAIL' })).toBe(true);

    machine.send({ type: 'FAIL' });

    expect(machine.snapshot).toEqual({
      value: 'failed',
      previousValue: 'idle',
      context: {
        attempts: 0,
        destination: null,
        reason: 'global-failure',
      },
      version: 1,
    });
  });

  it('keeps machine changes transactional when transition work throws', () => {
    const logger = createLogger();
    const boom = new Error('reducer failed');
    const machine = createMachine({
      logger,
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
            reducer: () => {
              throw boom;
            },
          },
          FAIL: {
            target: 'failed',
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
    });

    expect(() => machine.send({ type: 'DIAL', destination: '1001' })).toThrow(
      boom,
    );
    expect(machine.snapshot).toEqual({
      value: 'idle',
      previousValue: null,
      context: createContext(),
      version: 0,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'fsm: context reducer failed',
      expect.objectContaining({
        name: 'call-flow',
        state: 'idle',
        eventType: 'DIAL',
        target: 'dialing',
        error: boom,
      }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      'fsm: context reducer failed',
      expect.objectContaining({
        meta: expect.anything(),
      }),
    );

    machine.send({ type: 'FAIL' });

    expect(machine.state).toBe('failed');
    expect(machine.snapshot.version).toBe(1);
  });

  it('keeps machine changes transactional when lifecycle hooks throw', () => {
    const logger = createLogger();
    const boom = new Error('before commit failed');
    const machine = createMachine({
      logger,
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
          },
          FAIL: {
            target: 'failed',
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
      onTransitionBeforeCommit: (payload) => {
        if (payload.event.type === 'DIAL') throw boom;
      },
    });

    expect(() => machine.send({ type: 'DIAL', destination: '1001' })).toThrow(
      boom,
    );
    expect(machine.snapshot).toEqual({
      value: 'idle',
      previousValue: null,
      context: createContext(),
      version: 0,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'fsm: transition before commit hook failed',
      expect.objectContaining({
        name: 'call-flow',
        from: 'idle',
        to: 'dialing',
        eventType: 'DIAL',
        error: boom,
      }),
    );

    machine.send({ type: 'FAIL' });

    expect(machine.state).toBe('failed');
  });

  it('rejects re-entrant sends during lifecycle hooks', () => {
    const machine = createMachine({
      transitions: {
        idle: {
          DIAL: {
            target: 'dialing',
          },
          FAIL: {
            target: 'failed',
          },
        },
        dialing: {},
        connected: {},
        failed: {},
        '*': {},
      },
      onTransitionStart: (payload) => {
        if (payload.event.type === 'DIAL') machine.send({ type: 'FAIL' });
      },
    });

    expect(() => machine.send({ type: 'DIAL', destination: '1001' })).toThrow(
      'fsm: cannot call send() while a transition is in progress',
    );
    expect(machine.snapshot).toEqual({
      value: 'idle',
      previousValue: null,
      context: createContext(),
      version: 0,
    });

    machine.send({ type: 'FAIL' });

    expect(machine.state).toBe('failed');
  });
});
