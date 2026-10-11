import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RpcClient } from '../index.js';
import { createChannel } from './helpers.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('does not overwrite a pending request when the generator repeats an ID', async () => {
  const channel = createChannel();
  const rpc = new RpcClient({ channel, createRequestId: () => 'same' });
  const first = rpc.request({ method: 'first' });
  await expect(rpc.request({ method: 'second' })).rejects.toMatchObject({
    kind: 'id',
  });
  channel.receive({ id: 'same', result: 1 });
  await expect(first).resolves.toBe(1);
  expect(channel.sent).toHaveLength(1);
  rpc.stop();
});

it('rejects READY wait timeouts without sending or allocating IDs', async () => {
  const channel = createChannel('connecting');
  const createRequestId = vi.fn();
  const rpc = new RpcClient({ channel, createRequestId, readyTimeoutMs: 10 });
  const request = rpc.request({ method: 'getUserInfo' });
  const failed = expect(request).rejects.toMatchObject({ kind: 'timeout' });
  vi.advanceTimersByTime(10);
  await failed;
  channel.transition('ready');
  expect(channel.sent).toEqual([]);
  expect(createRequestId).not.toHaveBeenCalled();
  rpc.stop();
});

it('settles cancellation once and ignores an answer that arrives afterwards', async () => {
  const channel = createChannel();
  const rpc = new RpcClient({ channel });
  const controller = new AbortController();
  const request = rpc.request(
    { method: 'getUserInfo' },
    { signal: controller.signal },
  );
  const failed = expect(request).rejects.toMatchObject({ kind: 'aborted' });
  controller.abort();
  channel.receive({ id: channel.sent[0].id, result: 'late' });
  await failed;
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  rpc.stop();
});

it('counts reserved work before invoking a reentrant generator', async () => {
  const channel = createChannel();
  let nested;
  const rpc = new RpcClient({
    channel,
    maxPending: 1,
    createRequestId: () => {
      nested = rpc.request({ method: 'nested' });
      return 'outer';
    },
  });
  const outer = rpc.request({ method: 'outer' });
  await expect(nested).rejects.toMatchObject({ kind: 'capacity' });
  channel.receive({ id: 'outer', result: true });
  await expect(outer).resolves.toBe(true);
  rpc.stop();
});

it('never writes after a generator or onWillSend callback stops the RPC client', async () => {
  for (const hook of ['createRequestId', 'onWillSend']) {
    const channel = createChannel();
    const stop = () => {
      rpc.stop();
      return 'id';
    };
    const rpc = new RpcClient({
      channel,
      ...(hook === 'createRequestId' ? { createRequestId: stop } : {}),
    });
    await expect(
      rpc.request(
        { method: 'sendMessage' },
        hook === 'onWillSend' ? { onWillSend: stop } : {},
      ),
    ).rejects.toMatchObject({ kind: 'stopped' });
    expect(channel.sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  }
});

it('does not consume pending slots or leak listeners after malformed options', async () => {
  const channel = createChannel();
  const rpc = new RpcClient({ channel });
  for (const options of [
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
    { onWillSend: 1 },
    { signal: {} },
  ]) {
    await expect(
      rpc.request({ method: 'getUserInfo' }, options),
    ).rejects.toBeInstanceOf(Error);
    expect(rpc.pendingCount).toBe(0);
  }
  rpc.stop();
});

it('unsubscribes if registering the state subscription fails', () => {
  const channel = createChannel();
  channel.subscribe = () => {
    throw new Error('subscription failed');
  };
  expect(() => new RpcClient({ channel })).toThrow('subscription failed');
  expect(channel.subscriptions).toBe(0);
});

it('rejects malformed matched errors and ambiguous result/error frames', async () => {
  const channel = createChannel();
  const rpc = new RpcClient({ channel, createRequestId: () => 'id' });
  for (const data of [
    { error: { code: null } },
    { result: null, error: { code: 500 } },
  ]) {
    const request = rpc.request({ method: 'getUserInfo' });
    const failed = expect(request).rejects.toMatchObject({ kind: 'protocol' });
    channel.receive({ id: 'id', ...data });
    await failed;
  }
  rpc.stop();
});
