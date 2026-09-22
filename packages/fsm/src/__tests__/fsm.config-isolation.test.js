import { describe, expect, it } from 'vitest';

import { Fsm } from '../index.js';

import { createConfig, createContext, createStates } from './helpers.js';

describe('Fsm config isolation', () => {
  it('ignores mutations to the transition definitions after construction', () => {
    const dialTransition = { target: 'dialing' };
    const transitions = {
      idle: {
        DIAL: dialTransition,
      },
      dialing: {},
      connected: {},
      failed: {},
      '*': {},
    };
    const machine = new Fsm(createConfig({ transitions }));

    dialTransition.target = 'failed';

    machine.send({ type: 'DIAL', destination: '1001' });

    expect(machine.state).toBe('dialing');
  });

  it('ignores mutations to the state definitions after construction', () => {
    let enterCalls = 0;
    const dialingState = {
      onEnter: () => {
        enterCalls += 1;
      },
    };
    const states = {
      ...createStates(),
      dialing: dialingState,
    };
    const machine = new Fsm(
      createConfig({
        states,
        transitions: {
          idle: { DIAL: { target: 'dialing' } },
          dialing: {},
          connected: {},
          failed: {},
          '*': {},
        },
      }),
    );

    let mutatedCalls = 0;
    dialingState.onEnter = () => {
      mutatedCalls += 1;
    };

    machine.send({ type: 'DIAL', destination: '1001' });

    expect(enterCalls).toBe(1);
    expect(mutatedCalls).toBe(0);
  });

  it('does not copy the context object during construction', () => {
    const context = createContext();
    const machine = new Fsm(createConfig({ context }));

    expect(machine.context).toBe(context);
  });
});
