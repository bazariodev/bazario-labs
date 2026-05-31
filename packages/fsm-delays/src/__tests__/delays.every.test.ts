import { describe, expect, it } from 'vitest';

import { FsmDelays } from '../fsm-delays.js';
import { createMachine, createStubScheduler } from './helpers.js';

describe('FsmDelays every (repeating)', () => {
  it('fires the event repeatedly on the interval', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { connected: { every: 5_000, send: { type: 'PING' } } },
    });

    scheduler.advance(12_000); // ticks at 5_000 and 10_000
    expect(machine.context.pings).toBe(2);
    expect(machine.state).toBe('connected');

    scheduler.advance(3_000); // tick at 15_000
    expect(machine.context.pings).toBe(3);
  });

  it('keeps the interval running across self-transitions it triggers', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    // PING is a connected -> connected self-transition; the interval must not be
    // cancelled or restarted by the events it sends.
    new FsmDelays(machine, {
      scheduler,
      delays: { connected: { every: 1_000, send: { type: 'PING' } } },
    });

    scheduler.advance(3_000);
    expect(machine.context.pings).toBe(3);
    expect(scheduler.pending()).toBe(1);
  });

  it('clears the interval when the state is left', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { connected: { every: 5_000, send: { type: 'PING' } } },
    });

    scheduler.advance(12_000);
    expect(machine.context.pings).toBe(2);

    machine.send({ type: 'HANGUP' });
    expect(machine.state).toBe('idle');
    expect(scheduler.pending()).toBe(0);

    scheduler.advance(60_000);
    expect(machine.context.pings).toBe(2);
  });
});
