import { describe, expect, it, vi } from 'vitest';

import { SyncExecutor } from '../index.js';

describe('SyncExecutor', () => {
  it('drains synchronously in FIFO order without a recursive drain', () => {
    const executor = new SyncExecutor();
    const calls = [];

    executor.enqueue(() => {
      calls.push('first:start');
      executor.enqueue(() => {
        calls.push('second');
        executor.enqueue(() => calls.push('fourth'));
      });
      executor.enqueue(() => calls.push('third'));
      calls.push('first:end');
    });

    expect(calls).toEqual([
      'first:start',
      'first:end',
      'second',
      'third',
      'fourth',
    ]);
  });

  it('discards pending work on failure, rethrows the same error, and remains reusable', () => {
    const executor = new SyncExecutor();
    const calls = [];
    const failure = new Error('task failed');

    let thrown;
    try {
      executor.enqueue(() => {
        executor.enqueue(() => calls.push('discarded'));
        throw failure;
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    expect(calls).toEqual([]);

    executor.enqueue(() => calls.push('reused'));
    expect(calls).toEqual(['reused']);
  });

  it('clears later nested work after a nested task fails', () => {
    const executor = new SyncExecutor();
    const calls = [];
    const failure = new Error('nested failure');
    let thrown;

    try {
      executor.enqueue(() => {
        executor.enqueue(() => {
          calls.push('nested');
          throw failure;
        });
        executor.enqueue(() => calls.push('discarded'));
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failure);
    expect(calls).toEqual(['nested']);
    executor.enqueue(() => calls.push('reused'));
    expect(calls).toEqual(['nested', 'reused']);
  });

  it('stops during the current task, clears pending work, and rejects later work', () => {
    const executor = new SyncExecutor();
    const calls = [];

    executor.enqueue(() => {
      executor.enqueue(() => calls.push('discarded'));
      executor.stop();
      calls.push('current-finished');
    });

    expect(calls).toEqual(['current-finished']);
    const never = vi.fn();
    expect(() => executor.enqueue(never)).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
    expect(never).not.toHaveBeenCalled();
    executor[Symbol.dispose]();
  });

  it('disposal alone stops execution and repeated stop is inert', () => {
    const executor = new SyncExecutor();
    executor[Symbol.dispose]();
    executor.stop();
    const task = vi.fn();

    expect(() => executor.enqueue(task)).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
    expect(task).not.toHaveBeenCalled();
  });

  it('calls each admitted task once and does not invoke non-functions', () => {
    const executor = new SyncExecutor();
    const task = vi.fn();

    executor.enqueue(task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(() => executor.enqueue(null)).toThrow(TypeError);
  });
});
