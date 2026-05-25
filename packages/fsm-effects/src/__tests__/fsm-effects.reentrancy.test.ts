import { describe, expect, it } from 'vitest';

import { FsmEffects } from '../fsm-effects.js';
import { createMachine } from './helpers.js';

describe('FsmEffects re-entrancy', () => {
  it('allows api.send from inside an effect body to drive the machine', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    new FsmEffects(machine, {
      effects: {
        a: (_, api) => {
          log.push('a-enter');
          api.send({ type: 'GO_B' });
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    expect(machine.state).toBe('b');
    expect(log).toEqual(['a-enter', 'b-enter']);
  });

  it('skips stale subscriber callbacks via the version guard', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    machine.subscribe((snapshot) => {
      if (snapshot.value === 'b') machine.send({ type: 'GO_C' });
    });

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
        },
        b: () => {
          log.push('b-enter');
        },
        c: () => {
          log.push('c-enter');
        },
      },
    });

    log.length = 0;
    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('c');
    expect(log).toEqual(['c-enter']);
  });

  it('does not spawn stale effects when cleanup triggers a nested send to a different state', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
          return () => {
            log.push('a-cleanup');
            machine.send({ type: 'GO_C' });
          };
        },
        b: () => {
          log.push('b-enter');
        },
        c: () => {
          log.push('c-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('c');
    expect(log).toEqual(['a-enter', 'a-cleanup', 'c-enter']);
  });

  it('still spawns entered-state effects when cleanup triggers a self-transition on that state', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
          return () => {
            log.push('a-cleanup');
            machine.send({ type: 'PING' });
          };
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(machine.snapshot.version).toBe(2);
    expect(log).toEqual(['a-enter', 'a-cleanup', 'b-enter']);
  });

  it('does not double-spawn effects when a cascade returns to the original target state', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
          return () => {
            log.push('a-cleanup');
            machine.send({ type: 'GO_C' });
          };
        },
        b: () => {
          log.push('b-enter');
        },
        c: () => {
          log.push('c-enter');
          machine.send({ type: 'GO_D' });
        },
        d: () => {
          log.push('d-enter');
          machine.send({ type: 'GO_B' });
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(log.filter((entry) => entry === 'b-enter')).toEqual(['b-enter']);
    expect(log).toEqual([
      'a-enter',
      'a-cleanup',
      'c-enter',
      'd-enter',
      'b-enter',
    ]);
  });

  it('stops the spawn loop for the leaving state when a nested send aborts its controller mid-spawn', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    new FsmEffects(machine, {
      effects: {
        b: [
          (_, api) => {
            log.push('b-1');
            api.send({ type: 'GO_C' });
          },
          () => {
            log.push('b-2-should-not-run');
          },
        ],
        c: () => {
          log.push('c-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('c');
    expect(log).toEqual(['b-1', 'c-enter']);
  });

  it('no-ops api.send invoked from a cleanup after the state has been left', () => {
    const machine = createMachine('a');
    const log: string[] = [];

    new FsmEffects(machine, {
      effects: {
        a: (_, api) => {
          return () => {
            api.send({ type: 'GO_C' });
            log.push('a-cleanup');
          };
        },
        b: () => {
          log.push('b-enter');
        },
        c: () => {
          log.push('c-enter-should-not-run');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(log).toEqual(['a-cleanup', 'b-enter']);
  });
});
