import { describe, expect, it } from 'vitest';

import { Fsm } from '../index.js';

import { createConfig, createStates, createTransitions } from './helpers.js';

describe('Fsm validation', () => {
  const instantiate = (config) => {
    new Fsm(config);
  };

  const invalidConfigs = [
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
      'fsm: transition target "*" must exist in states',
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
  ];

  it.each(invalidConfigs)('rejects %s', (_caseName, config, message) => {
    expect(() => instantiate(config)).toThrow(message);
  });
});
