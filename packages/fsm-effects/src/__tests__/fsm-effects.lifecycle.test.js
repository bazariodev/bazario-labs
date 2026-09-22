import { describe, expect, it, vi } from 'vitest';

import { FsmEffects } from '../index.js';
import { createMachine } from './helpers.js';

describe('FsmEffects lifecycle', () => {
  it('spawns initial-state effects during construction', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
        },
      },
    });

    expect(log).toEqual(['a-enter']);
  });

  it('passes the committed snapshot and a frozen api to the effect', () => {
    const machine = createMachine('a');
    const effect = vi.fn();

    new FsmEffects(machine, { effects: { a: effect } });

    expect(effect).toHaveBeenCalledOnce();
    const [snapshot, api] = effect.mock.calls[0];
    expect(snapshot).toBe(machine.snapshot);
    expect(snapshot.value).toBe('a');
    expect(snapshot.previousValue).toBeNull();
    expect(snapshot.version).toBe(0);
    expect(api.signal).toBeInstanceOf(AbortSignal);
    expect(typeof api.send).toBe('function');
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('spawns wildcard effects in addition to state-specific effects', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a');
        },
        '*': () => {
          log.push('star');
        },
      },
    });

    expect(log).toEqual(['a', 'star']);
  });

  it('runs state-specific effects before wildcard effects', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        '*': () => {
          log.push('star');
        },
        a: () => {
          log.push('a');
        },
      },
    });

    expect(log).toEqual(['a', 'star']);
  });

  it('runs multiple effects on a state in declaration order', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: [
          () => {
            log.push('a1');
          },
          () => {
            log.push('a2');
          },
          () => {
            log.push('a3');
          },
        ],
      },
    });

    expect(log).toEqual(['a1', 'a2', 'a3']);
  });

  it('spawns new-state effects on transition', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['a-enter', 'b-enter']);
  });

  it('runs the cleanup from the leaving state before spawning the entered state', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
          return () => {
            log.push('a-cleanup');
          };
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['a-enter', 'a-cleanup', 'b-enter']);
  });

  it('runs cleanups for multiple effects on the same state in registration order', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: [
          () => () => {
            log.push('cleanup-1');
          },
          () => () => {
            log.push('cleanup-2');
          },
          () => () => {
            log.push('cleanup-3');
          },
        ],
      },
    });

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['cleanup-1', 'cleanup-2', 'cleanup-3']);
  });

  it('spawns nothing for states without effect entries', () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(log).toEqual(['a-enter']);
  });

  it('does not restart effects on self-transition', () => {
    const machine = createMachine('a');
    machine.send({ type: 'GO_B' });

    const log = [];

    new FsmEffects(machine, {
      effects: {
        b: () => {
          log.push('b-enter');
          return () => {
            log.push('b-cleanup');
          };
        },
      },
    });

    log.length = 0;
    machine.send({ type: 'PING' });

    expect(machine.state).toBe('b');
    expect(machine.snapshot.version).toBeGreaterThan(0);
    expect(log).toEqual([]);
  });

  it('delivers an effect a snapshot whose value matches the entered state', () => {
    const machine = createMachine('a');
    const visited = [];

    new FsmEffects(machine, {
      effects: {
        '*': (snapshot) => {
          visited.push({
            value: snapshot.value,
            version: snapshot.version,
          });
        },
      },
    });

    machine.send({ type: 'GO_B' });
    machine.send({ type: 'GO_C' });

    expect(visited).toEqual([
      { value: 'a', version: 0 },
      { value: 'b', version: 1 },
      { value: 'c', version: 2 },
    ]);
  });
});
