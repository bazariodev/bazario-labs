import { describe, expect, it } from 'vitest';

import { Fsm } from '../fsm.js';
import type { TransitionMap } from '../types.js';
import {
  type CallContext,
  type CallEvent,
  type CallState,
  createConfig,
  createContext,
  createStates,
} from './helpers.js';

describe('Fsm config isolation', () => {
  it('ignores mutations to the transition definitions after construction', () => {
    const dialTransition = { target: 'dialing' as CallState };
    const transitions: TransitionMap<CallState, CallEvent, CallContext> = {
      idle: {
        DIAL: dialTransition,
      },
      dialing: {},
      connected: {},
      failed: {},
      '*': {},
    };
    const machine = new Fsm<CallState, CallEvent, CallContext>(
      createConfig({ transitions }),
    );

    (dialTransition as { target: CallState }).target = 'failed';

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
    const machine = new Fsm<CallState, CallEvent, CallContext>(
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
    (dialingState as { onEnter: () => void }).onEnter = () => {
      mutatedCalls += 1;
    };

    machine.send({ type: 'DIAL', destination: '1001' });

    expect(enterCalls).toBe(1);
    expect(mutatedCalls).toBe(0);
  });

  it('does not copy the context object during construction', () => {
    const context = createContext();
    const machine = new Fsm<CallState, CallEvent, CallContext>(
      createConfig({ context }),
    );

    expect(machine.context).toBe(context);
  });
});
