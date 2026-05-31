import { describe, expect, it } from 'vitest';

import { compileDelays } from '../compile-delays.js';
import { FsmDelays } from '../fsm-delays.js';
import type { DelaysConfig } from '../types.js';
import {
  type Context,
  createLogger,
  createMachine,
  createStubScheduler,
  type Event,
  type State,
} from './helpers.js';

type Config = DelaysConfig<State, Event, Context>;
const compile = (config: unknown): void => {
  compileDelays(config as Config);
};

describe('compileDelays validation', () => {
  it('throws when delays is not an object', () => {
    expect(() => compile({ delays: null })).toThrow(
      'fsm-delays: delays must be an object',
    );
  });

  it('throws when delays is an array', () => {
    expect(() => compile({ delays: [] })).toThrow(
      'fsm-delays: delays must be an object',
    );
  });

  it('throws when an entry is not a delay spec', () => {
    expect(() => compile({ delays: { ringing: 42 } })).toThrow(
      /delays\["ringing"\]\[0\] must be a delay spec/,
    );
  });

  it('throws when an array element is not a delay spec', () => {
    expect(() =>
      compile({
        delays: { ringing: [{ after: 1, send: { type: 'PING' } }, 7] },
      }),
    ).toThrow(/delays\["ringing"\]\[1\] must be a delay spec/);
  });

  it('throws when a spec has both `after` and `every`', () => {
    expect(() =>
      compile({
        delays: { ringing: { after: 1, every: 1, send: { type: 'PING' } } },
      }),
    ).toThrow(/must have exactly one of "after" or "every"/);
  });

  it('throws when a spec has neither `after` nor `every`', () => {
    expect(() =>
      compile({ delays: { ringing: { send: { type: 'PING' } } } }),
    ).toThrow(/must have exactly one of "after" or "every"/);
  });

  it('throws when a spec is missing `send`', () => {
    expect(() => compile({ delays: { ringing: { after: 1 } } })).toThrow(
      /is missing "send"/,
    );
  });

  it('throws on a negative static `after`', () => {
    expect(() =>
      compile({ delays: { ringing: { after: -1, send: { type: 'PING' } } } }),
    ).toThrow(/\.after must be a finite number >= 0/);
  });

  it('throws on a non-finite static `after`', () => {
    expect(() =>
      compile({
        delays: {
          ringing: { after: Number.POSITIVE_INFINITY, send: { type: 'PING' } },
        },
      }),
    ).toThrow(/\.after must be a finite number >= 0/);
  });

  it('throws on a zero static `every`', () => {
    expect(() =>
      compile({ delays: { connected: { every: 0, send: { type: 'PING' } } } }),
    ).toThrow(/\.every must be a finite number > 0/);
  });

  it('treats an undefined entry as absent', () => {
    expect(() => compile({ delays: { ringing: undefined } })).not.toThrow();
  });
});

describe('FsmDelays dynamic resolution', () => {
  it('warns and skips a dynamic `after` that resolves to an invalid value', () => {
    const machine = createMachine('idle');
    const scheduler = createStubScheduler();
    const logger = createLogger();

    new FsmDelays(machine, {
      scheduler,
      logger,
      delays: { ringing: { after: () => -5, send: { type: 'NO_ANSWER' } } },
    });

    machine.send({ type: 'CALL' });

    expect(scheduler.pending()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'fsm-delays: skipped "after" with invalid duration',
      expect.objectContaining({ state: 'ringing', after: -5 }),
    );

    scheduler.advance(100_000);
    expect(machine.state).toBe('ringing');
  });

  it('warns and skips a dynamic `every` that resolves to an invalid value', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();
    const logger = createLogger();

    new FsmDelays(machine, {
      scheduler,
      logger,
      delays: { connected: { every: () => 0, send: { type: 'PING' } } },
    });

    expect(scheduler.pending()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'fsm-delays: skipped "every" with invalid interval',
      expect.objectContaining({ state: 'connected', every: 0 }),
    );

    scheduler.advance(100_000);
    expect(machine.context.pings).toBe(0);
  });
});
