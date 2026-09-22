import { describe, expect, it, vi } from 'vitest';

import { FsmEffects } from '../index.js';
import { createMachine } from './helpers.js';

describe('FsmEffects stop', () => {
  it('aborts the current controller and runs registered cleanups on stop()', () => {
    const machine = createMachine('a');
    const log = [];

    const runner = new FsmEffects(machine, {
      effects: {
        a: () => () => {
          log.push('a-cleanup');
        },
      },
    });

    runner.stop();

    expect(log).toEqual(['a-cleanup']);
  });

  it('treats a returned function as a cleanup even if it has a then property', () => {
    const machine = createMachine('a');
    let cleaned = 0;
    const cleanup = Object.assign(
      () => {
        cleaned += 1;
      },
      // biome-ignore lint/suspicious/noThenProperty: the test needs a function that looks thenable
      { then: () => undefined },
    );

    const runner = new FsmEffects(machine, { effects: { a: () => cleanup } });
    runner.stop();

    expect(cleaned).toBe(1);
  });

  it('ignores subsequent machine transitions after stop()', () => {
    const machine = createMachine('a');
    const log = [];

    const runner = new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    runner.stop();
    log.length = 0;

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(log).toEqual([]);
  });

  it('is idempotent — second stop() does not re-fire cleanups', () => {
    const machine = createMachine('a');
    const cleanup = vi.fn();

    const runner = new FsmEffects(machine, {
      effects: { a: () => cleanup },
    });

    runner.stop();
    runner.stop();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('Symbol.dispose aliases stop()', () => {
    const machine = createMachine('a');
    const cleanup = vi.fn();

    const runner = new FsmEffects(machine, {
      effects: { a: () => cleanup },
    });

    runner[Symbol.dispose]();
    runner.stop();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not spawn entered-state effects when stop() is called inside a cleanup', () => {
    const machine = createMachine('a');
    const log = [];
    let runner;

    runner = new FsmEffects(machine, {
      effects: {
        a: () => () => {
          log.push('a-cleanup');
          runner.stop();
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(log).toEqual(['a-cleanup']);
  });

  it('honors stop() called by an earlier subscriber in the same notification pass', () => {
    const machine = createMachine('a');
    const log = [];
    let runner;

    machine.subscribe(() => {
      runner?.stop();
    });

    runner = new FsmEffects(machine, {
      effects: {
        a: () => {
          log.push('a-enter');
        },
        b: () => {
          log.push('b-enter');
        },
      },
    });

    log.length = 0;
    machine.send({ type: 'GO_B' });

    expect(machine.state).toBe('b');
    expect(log).toEqual([]);
  });
});
