import { describe, expect, it, vi } from 'vitest';

import { createContext, createMachine, createStates } from './helpers.js';

describe('Fsm initialization', () => {
  it('exposes stable initial accessors without transition hooks', () => {
    const context = createContext();
    const onTransitionStart = vi.fn();
    const onTransitionBeforeCommit = vi.fn();
    const machine = createMachine({
      context,
      onTransitionStart,
      onTransitionBeforeCommit,
    });
    const snapshot = machine.snapshot;

    expect(machine.name).toBe('call-flow');
    expect(machine.state).toBe('idle');
    expect(machine.context).toBe(context);
    expect(machine.snapshot).toBe(snapshot);
    expect(snapshot).toEqual({
      value: 'idle',
      previousValue: null,
      context,
      version: 0,
    });
    expect(onTransitionStart).not.toHaveBeenCalled();
    expect(onTransitionBeforeCommit).not.toHaveBeenCalled();
  });

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
