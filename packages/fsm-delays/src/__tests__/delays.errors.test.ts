import { Fsm } from '@bazariodev/fsm';
import { describe, expect, it } from 'vitest';

import { FsmDelays } from '../fsm-delays.js';
import { createLogger, createMachine, createStubScheduler } from './helpers.js';

describe('FsmDelays delayed-callback error containment', () => {
  it('contains a throwing dynamic `send` resolver and logs it', () => {
    const machine = createMachine('idle');
    const scheduler = createStubScheduler();
    const logger = createLogger();
    const boom = new Error('send-resolver-boom');

    new FsmDelays(machine, {
      scheduler,
      logger,
      delays: {
        ringing: {
          after: 1_000,
          send: () => {
            throw boom;
          },
        },
      },
    });

    machine.send({ type: 'CALL' });

    // The timer fires later, outside the effects runner's try/catch; the throw
    // must not escape advance().
    expect(() => scheduler.advance(1_000)).not.toThrow();
    expect(machine.state).toBe('ringing');
    expect(logger.error).toHaveBeenCalledWith(
      'fsm-delays: delayed send threw',
      expect.objectContaining({ state: 'ringing', error: boom }),
    );
  });

  it('contains a machine error raised by the delayed api.send', () => {
    const boom = new Error('reducer-boom');
    const machine = new Fsm<'a' | 'b', { type: 'GO' }, { n: number }>({
      name: 'throwing-reducer',
      initial: 'a',
      context: { n: 0 },
      states: { a: {}, b: {} },
      transitions: {
        a: {
          GO: {
            target: 'b',
            reducer: () => {
              throw boom;
            },
          },
        },
        b: {},
        '*': {},
      },
    });
    const scheduler = createStubScheduler();
    const logger = createLogger();

    new FsmDelays(machine, {
      scheduler,
      logger,
      delays: { a: { after: 1_000, send: { type: 'GO' } } },
    });

    expect(() => scheduler.advance(1_000)).not.toThrow();
    expect(machine.state).toBe('a'); // transition never committed
    expect(logger.error).toHaveBeenCalledWith(
      'fsm-delays: delayed send threw',
      expect.objectContaining({ state: 'a', error: boom }),
    );
  });
});
