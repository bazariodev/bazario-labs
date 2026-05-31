import { describe, expect, it } from 'vitest';

import { FsmDelays } from '../fsm-delays.js';
import { createMachine, createStubScheduler } from './helpers.js';

describe('FsmDelays after (one-shot)', () => {
  it('fires the configured event after the delay elapses', () => {
    const machine = createMachine('idle');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { ringing: { after: 30_000, send: { type: 'NO_ANSWER' } } },
    });

    machine.send({ type: 'CALL' });
    expect(machine.state).toBe('ringing');

    scheduler.advance(29_999);
    expect(machine.state).toBe('ringing');

    scheduler.advance(1);
    expect(machine.state).toBe('failed');
  });

  it('cancels the pending timer when the state is left', () => {
    const machine = createMachine('idle');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { ringing: { after: 30_000, send: { type: 'NO_ANSWER' } } },
    });

    machine.send({ type: 'CALL' });
    machine.send({ type: 'ANSWER' });

    expect(machine.state).toBe('connected');
    expect(scheduler.pending()).toBe(0);

    scheduler.advance(60_000);
    expect(machine.state).toBe('connected');
  });

  it('schedules `after: 0` asynchronously, not during entry', () => {
    const machine = createMachine('idle');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { ringing: { after: 0, send: { type: 'NO_ANSWER' } } },
    });

    machine.send({ type: 'CALL' });
    expect(machine.state).toBe('ringing');

    scheduler.advance(0);
    expect(machine.state).toBe('failed');
  });

  it('resolves a dynamic `after` from the entry snapshot', () => {
    const machine = createMachine('reconnecting', { pings: 0, attempts: 3 });
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: {
        reconnecting: {
          after: (snapshot) => snapshot.context.attempts * 1_000,
          send: { type: 'RETRY' },
        },
      },
    });

    scheduler.advance(2_999);
    expect(machine.context.attempts).toBe(3);

    scheduler.advance(1);
    expect(machine.context.attempts).toBe(4);
  });

  it('resolves a dynamic `send` from the entry snapshot', () => {
    const machine = createMachine('idle', { pings: 0, attempts: 5 });
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: {
        ringing: {
          after: 1_000,
          send: (snapshot) =>
            snapshot.context.attempts > 0
              ? { type: 'ANSWER' }
              : { type: 'NO_ANSWER' },
        },
      },
    });

    machine.send({ type: 'CALL' });
    scheduler.advance(1_000);

    expect(machine.state).toBe('connected');
  });

  it('does not restart a one-shot timer on a self-transition', () => {
    const machine = createMachine('connected');
    const scheduler = createStubScheduler();

    new FsmDelays(machine, {
      scheduler,
      delays: { connected: { after: 10_000, send: { type: 'HANGUP' } } },
    });

    scheduler.advance(5_000);
    machine.send({ type: 'PING' }); // connected -> connected, must not re-arm

    scheduler.advance(5_000); // 10_000 total since entry
    expect(machine.state).toBe('idle');
  });
});
