import { describe, expect, it } from 'vitest';

import { FsmEffects } from '../index.js';
import { createMachine, flush } from './helpers.js';

describe('FsmEffects async effects', () => {
  it('returns from the constructor without awaiting the effect body', async () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: async () => {
          log.push('a-async-start');
          await Promise.resolve();
          log.push('a-async-end');
        },
      },
    });

    expect(log).toEqual(['a-async-start']);

    await flush();

    expect(log).toEqual(['a-async-start', 'a-async-end']);
  });

  it('registers a cleanup returned from a resolved promise', async () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: async () => {
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

    expect(log).toEqual(['a-enter']);

    await flush();

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['a-enter', 'a-cleanup', 'b-enter']);
  });

  it('invokes a late-arriving cleanup immediately when the controller already aborted', async () => {
    const machine = createMachine('a');
    const log = [];
    let resolveCleanup;
    const pending = new Promise((resolve) => {
      resolveCleanup = resolve;
    });

    new FsmEffects(machine, {
      effects: {
        a: () => pending,
        b: () => {
          log.push('b-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['b-enter']);

    resolveCleanup(() => {
      log.push('a-late-cleanup');
    });
    await flush();

    expect(log).toEqual(['b-enter', 'a-late-cleanup']);
  });

  it('ignores a promise that resolves to undefined (no cleanup to register)', async () => {
    const machine = createMachine('a');
    const log = [];

    new FsmEffects(machine, {
      effects: {
        a: async () => {
          log.push('a-enter');
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    await flush();

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['a-enter', 'b-enter']);
  });
});
