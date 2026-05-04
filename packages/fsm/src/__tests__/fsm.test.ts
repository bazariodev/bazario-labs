import { describe, expect, it, vi } from 'vitest';

import { Fsm } from '../fsm.js';
import type {
  FsmConfig,
  FsmSnapshot,
  Logger,
  StateDefinition,
  TransitionMap,
  Unsubscribe,
} from '../types.js';

type CallState = 'idle' | 'dialing' | 'connected' | 'failed';

type CallEvent =
  | { type: 'DIAL'; destination: string }
  | { type: 'CONNECT' }
  | { type: 'RESET' }
  | { type: 'FAIL' };

type CallContext = {
  attempts: number;
  destination: string | null;
  reason: string | null;
};

const createContext = (): CallContext => ({
  attempts: 0,
  destination: null,
  reason: null,
});

const createStates = (): Record<
  CallState,
  StateDefinition<CallState, CallEvent, CallContext>
> => ({
  idle: {},
  dialing: {},
  connected: {},
  failed: {},
});

const createTransitions = (): TransitionMap<
  CallState,
  CallEvent,
  CallContext
> => ({
  idle: {},
  dialing: {},
  connected: {},
  failed: {},
  '*': {},
});

const createConfig = (
  config: Partial<FsmConfig<CallState, CallEvent, CallContext>> = {},
): FsmConfig<CallState, CallEvent, CallContext> => ({
  name: config.name ?? 'call-flow',
  initial: config.initial ?? 'idle',
  context: config.context ?? createContext(),
  states: config.states ?? createStates(),
  transitions: config.transitions ?? createTransitions(),
  onTransitionStart: config.onTransitionStart,
  onTransitionBeforeCommit: config.onTransitionBeforeCommit,
  logger: config.logger,
});

const createMachine = (
  config: Partial<FsmConfig<CallState, CallEvent, CallContext>> = {},
): Fsm<CallState, CallEvent, CallContext> =>
  new Fsm<CallState, CallEvent, CallContext>(createConfig(config));

const createLogger = () =>
  ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) satisfies Logger;

describe('Fsm initialization', () => {
  it('enters the initial state during construction', () => {
    const context = createContext();
    const onEnter = vi.fn();

    createMachine({
      context,
      states: {
        ...createStates(),
        idle: {
          onEnter,
        },
      },
    });

    expect(onEnter).toHaveBeenCalledWith({
      from: null,
      to: 'idle',
      event: null,
      context,
    });
  });

  it('rethrows initial state enter failures from the constructor', () => {
    const boom = new Error('boom');

    expect(() =>
      createMachine({
        states: {
          ...createStates(),
          idle: {
            onEnter: () => {
              throw boom;
            },
          },
        },
      }),
    ).toThrow(boom);
  });
});

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

  it('rejects re-entrant sends during lifecycle hooks', () => {
    let machine: Fsm<CallState, CallEvent, CallContext>;
    machine = createMachine({
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

describe('Fsm subscriber delivery', () => {
  it('allows subscribers to send nested transitions after commit', () => {
    const deliveries: string[] = [];
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
      'second:dialing:1:connected',
    ]);
  });

  it('uses a stable subscriber list and logs subscriber failures', () => {
    const logger = createLogger();
    const calls: string[] = [];
    const boom = new Error('subscriber failed');
    const lateSubscriber = vi.fn(() => calls.push('late'));
    const secondSubscriber = vi.fn(() => calls.push('second'));
    const thirdSubscriber = vi.fn(() => calls.push('third'));
    let unsubscribeSecond: Unsubscribe = () => undefined;
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

describe('Fsm validation', () => {
  const instantiate = (config: unknown): void => {
    new Fsm(config as FsmConfig<CallState, CallEvent, CallContext>);
  };

  const invalidConfigs: ReadonlyArray<readonly [string, unknown, string]> = [
    [
      'empty names',
      {
        ...createConfig(),
        name: '   ',
      },
      'fsm: name must not be empty',
    ],
    [
      'initial states that are not declared',
      {
        ...createConfig(),
        initial: 'missing',
      },
      'fsm: initial state "missing" must exist in states',
    ],
    [
      'wildcard state declarations',
      {
        ...createConfig(),
        states: {
          ...createStates(),
          '*': {},
        },
      },
      'fsm: "*" is reserved and cannot be used as a state name',
    ],
    [
      'transition sources that are not declared states',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          missing: {
            DIAL: {
              target: 'idle',
            },
          },
        },
      },
      'fsm: transition source state "missing" must exist in states',
    ],
    [
      'wildcard transition targets',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: {
              target: '*',
            },
          },
        },
      },
      'fsm: "*" cannot be used as a transition target',
    ],
    [
      'transition targets that are not declared states',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: {
              target: 'missing',
            },
          },
        },
      },
      'fsm: transition target "missing" must exist in states',
    ],
  ];

  it.each(invalidConfigs)('rejects %s', (_caseName, config, message) => {
    expect(() => instantiate(config)).toThrow(message);
  });
});
