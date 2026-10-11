import { expect, it } from 'vitest';
import { RpcClient } from '../index.js';
import { createChannel } from './helpers.js';

function createScheduler(createHandle = () => Symbol('timer')) {
  const callbacks = [];
  const active = new Map();
  return {
    callbacks,
    get pendingCount() {
      return active.size;
    },
    setTimeout(callback) {
      const handle = createHandle();
      callbacks.push(callback);
      active.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      active.delete(handle);
    },
  };
}

it.each([
  ['distinct timer handles', () => Symbol('timer')],
  ['a reused timer handle', () => 1],
])('ignores an already queued READY timeout after sending with %s', async (_, createHandle) => {
  const channel = createChannel('connecting');
  const scheduler = createScheduler(createHandle);
  const rpc = new RpcClient({
    channel,
    scheduler,
    createRequestId: () => 'request-1',
  });
  const result = rpc.request({ method: 'getUserInfo' }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  const queuedReadyTimeout = scheduler.callbacks[0];

  channel.transition('ready');
  // Cancellation cannot retract a callback that the scheduler already queued.
  queuedReadyTimeout();
  channel.receive({ id: 'request-1', result: 'response' });

  expect(await result).toEqual({ value: 'response' });
  expect(rpc.pendingCount).toBe(0);
  expect(scheduler.pendingCount).toBe(0);
  rpc.stop();
});

for (const settlement of ['response', 'stop']) {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['an object', {}],
  ])(`clears an opaque timer handle of %s after ${settlement}`, async (_, handle) => {
    const channel = createChannel();
    const scheduler = createScheduler(() => handle);
    const rpc = new RpcClient({
      channel,
      scheduler,
      createRequestId: () => 'request-1',
    });
    const result = rpc.request({ method: 'getUserInfo' }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    if (settlement === 'response')
      channel.receive({ id: 'request-1', result: 'response' });
    else rpc.stop();

    const outcome = await result;
    rpc.stop();
    expect(outcome).toMatchObject(
      settlement === 'response'
        ? { value: 'response' }
        : { error: { kind: 'stopped' } },
    );
    expect(rpc.pendingCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });
}
