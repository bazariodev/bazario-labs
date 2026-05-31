import { FsmEffects } from '@bazariodev/fsm-effects';
import { describe, expect, it } from 'vitest';

import { compileDelays } from '../compile-delays.js';
import { FsmDelays } from '../fsm-delays.js';
import {
  type Context,
  createMachine,
  createStubScheduler,
  type Event,
  type State,
} from './helpers.js';

describe('FsmDelays lifecycle', () => {
  it('runs wildcard delays on every entered state', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { '*': { after: 1_000, send: { type: 'RESET' } } },
    });

    scheduler.advance(1_000);
    expect(machine.state).toBe('idle'); // RESET via wildcard transition
  });

  it('arms multiple specs on one state in declaration order', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: {
        connected: [
          { after: 1_000, send: { type: 'PING' } },
          { after: 2_000, send: { type: 'PING' } },
        ],
      },
    });

    scheduler.advance(1_000);
    expect(machine.context.pings).toBe(1);

    scheduler.advance(1_000);
    expect(machine.context.pings).toBe(2);
  });

  it('composes with hand-written effects in a single FsmEffects', () => {
    const machine = createMachine('idle');
    const scheduler = createStubScheduler();
    const log: string[] = [];

    const delayEffects = compileDelays<State, Event, Context>({
      scheduler,
      delays: { ringing: { after: 1_000, send: { type: 'NO_ANSWER' } } },
    });

    new FsmEffects(machine, {
      effects: {
        ...delayEffects,
        connected: () => {
          log.push('connected');
        },
      },
    });

    machine.send({ type: 'CALL' }); // ringing: delay arms
    machine.send({ type: 'ANSWER' }); // connected: delay cleared, manual effect runs

    expect(log).toEqual(['connected']);
    expect(scheduler.pending()).toBe(0);

    scheduler.advance(60_000);
    expect(machine.state).toBe('connected');
  });

  it('clears pending timers on stop()', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    const runner = new FsmDelays(machine, {
      scheduler,
      delays: { connected: { every: 5_000, send: { type: 'PING' } } },
    });

    scheduler.advance(12_000);
    expect(machine.context.pings).toBe(2);

    runner.stop();
    expect(scheduler.pending()).toBe(0);

    scheduler.advance(60_000);
    expect(machine.context.pings).toBe(2);
  });

  it('Symbol.dispose clears pending timers', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    const runner = new FsmDelays(machine, {
      scheduler,
      delays: { connected: { every: 5_000, send: { type: 'PING' } } },
    });

    scheduler.advance(5_000);
    expect(machine.context.pings).toBe(1);

    runner[Symbol.dispose]();
    expect(scheduler.pending()).toBe(0);
  });
});
