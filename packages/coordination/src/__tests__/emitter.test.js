import { describe, expect, it, vi } from 'vitest';

import { Emitter } from '../index.js';

describe('Emitter', () => {
  it('delivers synchronously in registration order from a stable snapshot', () => {
    const emitter = new Emitter();
    const calls = [];
    const late = () => calls.push('late');
    let unsubscribeSecond;

    emitter.on('message', () => {
      calls.push('first');
      unsubscribeSecond();
      emitter.on('message', late);
    });
    unsubscribeSecond = emitter.on('message', () => calls.push('second'));

    emitter.emit('message', 'one');
    expect(calls).toEqual(['first', 'second']);
    emitter.emit('message', 'two');
    expect(calls).toEqual(['first', 'second', 'first', 'late']);
  });

  it('shares duplicate registrations and protects later registrations from stale cleanup', () => {
    const emitter = new Emitter();
    const listener = vi.fn();
    const firstUnsubscribe = emitter.on('ready', listener);
    const duplicateUnsubscribe = emitter.on('ready', listener);

    expect(duplicateUnsubscribe).toBe(firstUnsubscribe);
    firstUnsubscribe();
    const laterUnsubscribe = emitter.on('ready', listener);
    firstUnsubscribe();
    emitter.emit('ready', undefined);

    expect(listener).toHaveBeenCalledTimes(1);
    laterUnsubscribe();
    laterUnsubscribe();
    emitter.emit('ready', undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats error as an ordinary event and does not replay old events', () => {
    const emitter = new Emitter();
    const first = vi.fn();
    const late = vi.fn();
    const payload = new Error('ordinary payload');

    emitter.on('error', first);
    emitter.emit('error', payload);
    emitter.on('error', late);
    expect(late).not.toHaveBeenCalled();
    emitter.emit('error', payload);
    expect(first).toHaveBeenCalledTimes(2);
    expect(late).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('delivers nested events immediately and suppresses all delivery after stop', () => {
    const emitter = new Emitter();
    const calls = [];

    emitter.on('event', (value) => {
      calls.push(`first:${value}`);
      if (value === 'outer') emitter.emit('event', 'nested');
    });
    emitter.on('event', (value) => {
      calls.push(`second:${value}`);
      if (value === 'nested') emitter.stop();
    });

    emitter.emit('event', 'outer');
    emitter.emit('event', 'after');

    expect(calls).toEqual(['first:outer', 'first:nested', 'second:nested']);
  });

  it('logs each listener error once with its identity and continues', () => {
    const failure = new Error('listener failed');
    const error = vi.fn();
    const emitter = new Emitter({ logger: { error } });
    const later = vi.fn();

    emitter.on(Symbol.for('event'), () => {
      throw failure;
    });
    emitter.on(Symbol.for('event'), later);
    emitter.emit(Symbol.for('event'), undefined);

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toBe('coordination: event listener failed');
    expect(error.mock.calls[0][1].type).toBe(Symbol.for('event'));
    expect(error.mock.calls[0][1].error).toBe(failure);
    expect(later).toHaveBeenCalledOnce();
  });

  it('rejects non-function listeners', () => {
    const emitter = new Emitter();
    expect(() => emitter.on('event', null)).toThrow(TypeError);
  });

  it('is inert after stop and does not retain new listeners', () => {
    const emitter = new Emitter();
    const listener = vi.fn();
    emitter.stop();

    const unsubscribe = emitter.on('event', listener);
    expect(unsubscribe).toBeTypeOf('function');
    expect(emitter.on('event', null)).toBeTypeOf('function');
    emitter.emit('event', undefined);
    unsubscribe();
    emitter[Symbol.dispose]();

    expect(listener).not.toHaveBeenCalled();
  });

  it('disposal alone prevents later subscriptions and emissions', () => {
    const emitter = new Emitter();
    const listener = vi.fn();
    const unsubscribe = emitter.on('event', listener);
    emitter[Symbol.dispose]();
    unsubscribe();
    const afterStop = emitter.on('event', listener);
    emitter.emit('event', undefined);
    afterStop();

    expect(listener).not.toHaveBeenCalled();
  });
});
