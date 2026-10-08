import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AsyncExecutor } from '../index.js';

describe('AsyncExecutor', () => {
  it('starts asynchronously and runs tasks serially with individual results', async () => {
    const executor = new AsyncExecutor();
    const calls = [];
    let releaseFirst;
    let started;
    const firstStarted = new Promise((resolve) => {
      started = resolve;
    });
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = executor.enqueue(async () => {
      calls.push('first:start');
      started();
      await firstGate;
      calls.push('first:end');
      return 1;
    });
    const second = executor.enqueue(() => {
      calls.push('second');
      return 2;
    });

    expect(calls).toEqual([]);
    await firstStarted;
    expect(calls).toEqual(['first:start']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(calls).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not start newly submitted work while an active task is pending', async () => {
    const executor = new AsyncExecutor();
    const calls = [];
    let started;
    let finish;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    const first = executor.enqueue(() => {
      calls.push('first');
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    await taskStarted;
    const second = executor.enqueue(() => {
      calls.push('second');
      return 2;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['first']);

    finish(1);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(calls).toEqual(['first', 'second']);
  });

  it('rejects failed tasks with their original error and continues', async () => {
    const executor = new AsyncExecutor();
    const failure = new Error('task failed');
    const failed = executor.enqueue(() => {
      throw failure;
    });
    const succeeding = executor.enqueue(() => 'ok');

    await expect(failed).rejects.toBe(failure);
    await expect(succeeding).resolves.toBe('ok');
  });

  it('continues after an asynchronous rejection', async () => {
    const executor = new AsyncExecutor();
    const failure = new Error('asynchronous failure');
    const failed = executor.enqueue(async () => {
      throw failure;
    });
    const succeeding = executor.enqueue(() => 'next');

    await expect(failed).rejects.toBe(failure);
    await expect(succeeding).resolves.toBe('next');
  });

  it('calls ordinary function tasks without binding an internal this value', async () => {
    const executor = new AsyncExecutor();
    let receivedThis;

    const result = executor.enqueue(function task() {
      receivedThis = this;
      return 'done';
    });

    await expect(result).resolves.toBe('done');
    expect(receivedThis).toBeUndefined();
  });

  it('rejects pending work when stopped before the first task starts', async () => {
    const executor = new AsyncExecutor();
    const calls = [];
    const pending = executor.enqueue(() => calls.push('started'));
    const outcome = pending.catch((error) => error);

    expect(calls).toEqual([]);
    executor.stop();
    const reason = await outcome;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reason.name).toBe('AbortError');
    expect(calls).toEqual([]);
  });

  it('uses a fresh signal for each task and never aborts a settled task on stop', async () => {
    const executor = new AsyncExecutor();
    const signals = [];
    const first = executor.enqueue((signal) => {
      signals.push(signal);
      signal.addEventListener('abort', () => {
        throw new Error('settled task was aborted');
      });
      return 1;
    });
    const second = executor.enqueue((signal) => {
      signals.push(signal);
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    executor.stop();

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it('does not abort a task whose rejection was already observed', async () => {
    const executor = new AsyncExecutor();
    const failure = new Error('failed');
    let signal;
    const result = executor.enqueue((taskSignal) => {
      signal = taskSignal;
      return Promise.reject(failure);
    });

    await expect(result).rejects.toBe(failure);
    executor.stop();

    expect(signal.aborted).toBe(false);
  });

  it('rejects pending work with one stop reason and aborts only the active task', async () => {
    const executor = new AsyncExecutor();
    let activeSignal;
    let rejectActive;
    let enqueueFromAbort;
    const active = executor.enqueue((signal) => {
      activeSignal = signal;
      signal.addEventListener('abort', () => {
        enqueueFromAbort = executor
          .enqueue(() => 'late')
          .catch((error) => error);
        rejectActive(signal.reason);
      });
      return new Promise((_resolve, reject) => {
        rejectActive = reject;
      });
    });
    const pending = executor.enqueue(() => 'never');

    const activeOutcome = active.catch((error) => error);
    const pendingOutcome = pending.catch((error) => error);
    while (!activeSignal)
      await new Promise((resolve) => setTimeout(resolve, 0));
    executor.stop();

    const [activeError, pendingError] = await Promise.all([
      activeOutcome,
      pendingOutcome,
    ]);
    const lateError = await enqueueFromAbort;

    expect(activeError).toBe(pendingError);
    expect(lateError).toBe(pendingError);
    expect(pendingError.name).toBe('AbortError');
    expect(activeSignal.aborted).toBe(true);
    expect(activeSignal.reason).toBe(pendingError);
  });

  it('lets an active task that ignores abort settle naturally after stop', async () => {
    const executor = new AsyncExecutor();
    let started;
    const taskStarted = new Promise((resolve) => {
      started = resolve;
    });
    let finish;
    const active = executor.enqueue(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const result = active.then((value) => value);

    await taskStarted;
    executor.stop();
    finish('finished');

    await expect(result).resolves.toBe('finished');
  });

  it('aborts its own active signal when stop is called inside the task', async () => {
    const executor = new AsyncExecutor();
    let signal;
    let abortCount = 0;
    const result = executor.enqueue((taskSignal) => {
      signal = taskSignal;
      signal.addEventListener('abort', () => {
        abortCount += 1;
      });
      executor.stop();
      return 'settled naturally';
    });

    await expect(result).resolves.toBe('settled naturally');
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('AbortError');
    expect(abortCount).toBe(1);
  });

  it('keeps one stop reason across repeated stop calls', async () => {
    const executor = new AsyncExecutor();
    executor.stop();
    const first = executor.enqueue(() => undefined).catch((error) => error);
    const firstError = await first;

    executor.stop();
    const second = executor.enqueue(() => undefined).catch((error) => error);
    const secondError = await second;

    expect(firstError).toBe(secondError);
    expect(firstError.name).toBe('AbortError');
  });

  it('disposal rejects pending work and prevents later submissions', async () => {
    const executor = new AsyncExecutor();
    const pending = executor.enqueue(() => 'never');
    const pendingOutcome = pending.catch((error) => error);

    executor[Symbol.dispose]();

    const reason = await pendingOutcome;
    const lateReason = await executor
      .enqueue(() => 'late')
      .catch((error) => error);
    expect(reason).toBe(lateReason);
    expect(reason.name).toBe('AbortError');
  });

  it('rejects a non-function submission without stopping later work', async () => {
    const executor = new AsyncExecutor();
    const invalid = executor.enqueue(null);
    const valid = executor.enqueue(() => 'ok');

    await expect(invalid).rejects.toBeInstanceOf(TypeError);
    await expect(valid).resolves.toBe('ok');
  });

  it.each([
    ['task failure', 'failure', 'Error'],
    ['pending cancellation', 'pending', 'AbortError'],
    ['post-stop submission', 'post-stop', 'AbortError'],
  ])('leaves %s rejections visible to the caller', (_label, scenario, errorName) => {
    const childPath = fileURLToPath(
      new URL('./unhandled-child.js', import.meta.url),
    );
    const child = spawnSync(process.execPath, [childPath, scenario], {
      encoding: 'utf8',
    });

    expect(child.status).toBe(0);
    expect(child.stdout).toContain(`unhandled:${errorName}`);
  });
});
