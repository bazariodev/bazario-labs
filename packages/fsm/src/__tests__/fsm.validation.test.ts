import { describe, expect, it } from 'vitest';

import { Fsm } from '../fsm.js';
import type { FsmConfig } from '../types.js';
import {
  type CallEvent,
  type CallState,
  createConfig,
  createStates,
  createTransitions,
} from './helpers.js';

describe('Fsm validation', () => {
  const instantiate = (config: unknown): void => {
    new Fsm(
      config as FsmConfig<
        CallState,
        CallEvent,
        { attempts: number; destination: string | null; reason: string | null }
      >,
    );
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
      'transition maps that are not objects',
      {
        ...createConfig(),
        transitions: undefined,
      },
      'fsm: transitions must be an object',
    ],
    [
      'transition source entries that are not event maps',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: null,
        },
      },
      'fsm: transition source "idle" must define an event map',
    ],
    [
      'empty transition definition arrays',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: [],
          },
        },
      },
      'fsm: transition entry "idle.DIAL" must include at least one definition',
    ],
    [
      'null transition definitions',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: null,
          },
        },
      },
      'fsm: transition definition "idle.DIAL[0]" must be an object',
    ],
    [
      'non-object transition definitions',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: 'dialing',
          },
        },
      },
      'fsm: transition definition "idle.DIAL[0]" must be an object',
    ],
    [
      'transition definitions without targets',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: {},
          },
        },
      },
      'fsm: transition definition "idle.DIAL[0]" must include target',
    ],
    [
      'transition definitions with non-string targets',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: {
              target: 1,
            },
          },
        },
      },
      'fsm: transition definition "idle.DIAL[0]" target must be a string',
    ],
    [
      'transition definitions with non-function guards',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: {
              target: 'dialing',
              guard: true,
            },
          },
        },
      },
      'fsm: transition definition "idle.DIAL[0]" guard must be a function',
    ],
    [
      'transition definitions with non-function reducers',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: {
              target: 'dialing',
              reducer: true,
            },
          },
        },
      },
      'fsm: transition definition "idle.DIAL[0]" reducer must be a function',
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
    [
      'initial state names inherited from Object.prototype',
      {
        ...createConfig(),
        initial: 'toString',
      },
      'fsm: initial state "toString" must exist in states',
    ],
    [
      'transition source names inherited from Object.prototype',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          toString: {
            DIAL: { target: 'idle' },
          },
        },
      },
      'fsm: transition source state "toString" must exist in states',
    ],
    [
      'transition targets inherited from Object.prototype',
      {
        ...createConfig(),
        transitions: {
          ...createTransitions(),
          idle: {
            DIAL: { target: 'toString' },
          },
        },
      },
      'fsm: transition target "toString" must exist in states',
    ],
    [
      'state maps that are not objects',
      {
        ...createConfig(),
        states: undefined,
      },
      'fsm: states must be an object',
    ],
    [
      'state definitions that are not objects',
      {
        ...createConfig(),
        states: {
          ...createStates(),
          idle: null,
        },
      },
      'fsm: state definition "idle" must be an object',
    ],
    [
      'state definitions with non-function onEnter',
      {
        ...createConfig(),
        states: {
          ...createStates(),
          idle: { onEnter: true },
        },
      },
      'fsm: state definition "idle" onEnter must be a function',
    ],
    [
      'state definitions with non-function onLeave',
      {
        ...createConfig(),
        states: {
          ...createStates(),
          idle: { onLeave: 42 },
        },
      },
      'fsm: state definition "idle" onLeave must be a function',
    ],
  ];

  it.each(invalidConfigs)('rejects %s', (_caseName, config, message) => {
    expect(() => instantiate(config)).toThrow(message);
  });
});
