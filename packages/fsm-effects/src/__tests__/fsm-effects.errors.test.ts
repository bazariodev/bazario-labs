import { Fsm } from '@bazariodev/fsm';
import { describe, expect, it } from 'vitest';

import { FsmEffects } from '../fsm-effects.js';
import { createLogger, createMachine } from './helpers.js';

describe('FsmEffects error containment', () => {
  it('catches sync throws from effect bodies and continues with siblings', () => {
    const logger = createLogger();
    const machine = createMachine('a');
    const boom = new Error('boom');
    const log: string[] = [];

    new FsmEffects(machine, {
      logger,
      effects: {
        a: [
          () => {
            throw boom;
          },
          () => {
            log.push('a-second');
          },
        ],
      },
    });

    expect(log).toEqual(['a-second']);
    expect(logger.error).toHaveBeenCalledWith(
      'fsm-effects: effect threw',
      expect.objectContaining({ state: 'a', error: boom }),
    );
  });

  it('logs async rejection at error level when the signal has not aborted', async () => {
    const logger = createLogger();
    const machine = createMachine('a');
    const boom = new Error('async-boom');

    new FsmEffects(machine, {
      logger,
      effects: {
        a: async () => {
          throw boom;
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      'fsm-effects: effect rejected',
      expect.objectContaining({ state: 'a', error: boom }),
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs async rejection at debug level when the signal has aborted', async () => {
    const logger = createLogger();
    const machine = createMachine('a');
    let trigger!: () => void;
    const wait = new Promise<void>((resolve) => {
      trigger = resolve;
    });

    new FsmEffects(machine, {
      logger,
      effects: {
        a: async () => {
          await wait;
          throw new Error('post-abort');
        },
        b: () => undefined,
      },
    });

    machine.send({ type: 'GO_B' });
    trigger();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.debug).toHaveBeenCalledWith(
      'fsm-effects: effect rejected after abort',
      expect.objectContaining({ state: 'a' }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      'fsm-effects: effect rejected',
      expect.anything(),
    );
  });

  it('catches cleanup throws and continues invoking other cleanups', () => {
    const logger = createLogger();
    const machine = createMachine('a');
    const boom = new Error('cleanup-boom');
    const log: string[] = [];

    new FsmEffects(machine, {
      logger,
      effects: {
        a: [
          () => () => {
            throw boom;
          },
          () => () => {
            log.push('a-cleanup-2');
          },
        ],
        b: () => {
          log.push('b-enter');
        },
      },
    });

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['a-cleanup-2', 'b-enter']);
    expect(logger.error).toHaveBeenCalledWith(
      'fsm-effects: cleanup threw',
      expect.objectContaining({ error: boom }),
    );
  });

  it('propagates machine errors raised by api.send when the signal is not aborted', () => {
    const boom = new Error('guard-failed');
    const machine = new Fsm<'a' | 'b', { type: 'FAIL' }, { count: number }>({
      name: 'throwing',
      initial: 'a',
      context: { count: 0 },
      states: { a: {}, b: {} },
      transitions: {
        a: {
          FAIL: {
            target: 'b',
            guard: () => {
              throw boom;
            },
          },
        },
        b: {},
        '*': {},
      },
    });

    let captured: unknown;

    new FsmEffects(machine, {
      effects: {
        a: (_, api) => {
          try {
            api.send({ type: 'FAIL' });
          } catch (error) {
            captured = error;
          }
        },
      },
    });

    expect(captured).toBe(boom);
    expect(machine.state).toBe('a');
  });
});
