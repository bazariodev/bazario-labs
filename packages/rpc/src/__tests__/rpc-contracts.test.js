import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RpcClient } from '../index.js';
import { createChannel } from './helpers.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('rejects waiting requests and notifications on idle without replaying them', async () => {
  const channel = createChannel('connecting');
  const createRequestId = vi.fn(() => 'fresh');
  const rpc = new RpcClient({ channel, createRequestId });
  const request = rpc.request({ method: 'getUserInfo' });
  const notification = rpc.notify({ method: 'messageTyped' });
  const failures = Promise.all([
    expect(request).rejects.toMatchObject({ kind: 'disconnected' }),
    expect(notification).rejects.toMatchObject({ kind: 'disconnected' }),
  ]);
  channel.transition('idle');
  await failures;
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  channel.transition('ready');
  expect(channel.sent).toEqual([]);
  expect(createRequestId).not.toHaveBeenCalled();
  await rpc.notify({ method: 'newNotification' });
  expect(channel.sent).toHaveLength(1);
  rpc.stop();
});

it.each([
  'connecting',
  'ready',
])('terminal channel stop rejects work from %s and releases subscriptions', async (state) => {
  const channel = createChannel(state);
  const rpc = new RpcClient({ channel });
  const request = rpc.request({ method: 'getUserInfo' });
  const failed = expect(request).rejects.toMatchObject({ kind: 'stopped' });
  channel.transition('stopped');
  await failed;
  expect(rpc.pendingCount).toBe(0);
  expect(channel.subscriptions).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  channel.transition('ready');
  await expect(rpc.notify({ method: 'afterStop' })).rejects.toMatchObject({
    kind: 'stopped',
  });
  expect(channel.sent).toHaveLength(state === 'ready' ? 1 : 0);
});

it.each([
  'connecting',
  'ready',
])('does not allocate IDs, write, or schedule with a pre-aborted signal while %s', async (state) => {
  const channel = createChannel(state);
  const createRequestId = vi.fn();
  const onWillSend = vi.fn();
  const rpc = new RpcClient({ channel, createRequestId });
  const controller = new AbortController();
  const cause = new Error('cancelled before submission');
  controller.abort(cause);
  for (const method of ['request', 'notify']) {
    await expect(
      rpc[method](
        { method: 'cancelled' },
        {
          signal: controller.signal,
          onWillSend,
        },
      ),
    ).rejects.toMatchObject({ kind: 'aborted', cause });
  }
  channel.transition('ready');
  expect(createRequestId).not.toHaveBeenCalled();
  expect(onWillSend).not.toHaveBeenCalled();
  expect(channel.sent).toEqual([]);
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  rpc.stop();
});

it('calls the injected ID generator without a receiver', async () => {
  const channel = createChannel();
  const createRequestId = vi.fn(function () {
    expect(this).toBeUndefined();
    return 'fresh';
  });
  const rpc = new RpcClient({ channel, createRequestId });
  const response = rpc.request({ method: 'getUserInfo' });
  expect(createRequestId).toHaveBeenCalledOnce();
  expect(channel.sent[0].id).toBe('fresh');
  channel.receive({ id: 'fresh', result: true });
  await expect(response).resolves.toBe(true);
  rpc.stop();
});

it('requires maxPending to be a positive safe integer before subscribing', () => {
  const channel = createChannel();
  for (const maxPending of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    '1',
    true,
  ]) {
    expect(() => new RpcClient({ channel, maxPending })).toThrow(RangeError);
    expect(channel.subscriptions).toBe(0);
  }
  for (const maxPending of [1, Number.MAX_SAFE_INTEGER]) {
    const rpc = new RpcClient({ channel, maxPending });
    expect(channel.subscriptions).toBe(2);
    rpc.stop();
  }
});

it('starts terminally stopped on an already-stopped channel', async () => {
  const channel = createChannel('stopped');
  const createRequestId = vi.fn();
  const rpc = new RpcClient({ channel, createRequestId });
  expect(channel.subscriptions).toBe(0);
  channel.transition('ready');
  for (const method of ['request', 'notify'])
    await expect(rpc[method]({ method: 'afterStop' })).rejects.toMatchObject({
      kind: 'stopped',
    });
  expect(createRequestId).not.toHaveBeenCalled();
  expect(channel.sent).toEqual([]);
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
