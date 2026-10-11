import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RpcClient, RpcResponseError } from '../index.js';
import { createChannel } from './helpers.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(options = {}, state) {
  const channel = createChannel(state);
  let id = 0;
  const rpc = new RpcClient({
    channel,
    createRequestId: () => `rpc-${++id}`,
    ...options,
  });
  return { rpc, channel };
}

it('matches concurrent responses in reverse order without exposing IDs to callers', async () => {
  const { rpc, channel } = setup();
  const first = rpc.request({ method: 'getUserInfo' });
  const second = rpc.request({
    method: 'sendMessage',
    params: { content: 'hello' },
  });
  expect(channel.sent).toEqual([
    { id: 'rpc-1', method: 'getUserInfo' },
    {
      id: 'rpc-2',
      method: 'sendMessage',
      params: { content: 'hello' },
    },
  ]);
  channel.receive({ id: 'rpc-2', result: { messageid: 'message-1' } });
  channel.receive({ id: 'rpc-1', result: { name: 'Alex' } });
  await expect(first).resolves.toEqual({ name: 'Alex' });
  await expect(second).resolves.toEqual({ messageid: 'message-1' });
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  rpc.stop();
});

it('registers correlation before a synchronous response during send', async () => {
  const { rpc, channel } = setup();
  channel.send.mockImplementation(({ id }) => {
    channel.receive({ id, result: false });
    return true;
  });
  await expect(rpc.request({ method: 'ping' })).resolves.toBe(false);
  rpc.stop();
});

it('sends and delivers notifications without creating request IDs or response promises', async () => {
  const createRequestId = vi.fn();
  const { rpc, channel } = setup({ createRequestId });
  const received = [];
  rpc.onNotification((value) => received.push(value));
  const notification = {
    method: 'messageTyped',
    params: { sessionid: 'chat-1', typing: true },
  };
  await rpc.notify(notification);
  expect(channel.sent).toEqual([notification]);
  expect(createRequestId).not.toHaveBeenCalled();
  channel.receive(notification);
  channel.receive({ id: 'late', result: 'old response' });
  expect(received).toEqual([notification]);
  expect(rpc.pendingCount).toBe(0);
  rpc.stop();
});

it('bounds READY waiting separately from response waiting and supports cancellation', async () => {
  const { rpc, channel } = setup(
    { readyTimeoutMs: 50, timeoutMs: 100 },
    'connecting',
  );
  const controller = new AbortController();
  const aborted = rpc.request(
    { method: 'cancelled' },
    { signal: controller.signal },
  );
  const failed = expect(aborted).rejects.toMatchObject({ kind: 'aborted' });
  controller.abort();
  await failed;
  const request = rpc.request({ method: 'getUserInfo' });
  const timedOut = expect(request).rejects.toMatchObject({ kind: 'timeout' });
  vi.advanceTimersByTime(40);
  expect(channel.sent).toHaveLength(0);
  channel.transition('ready');
  expect(channel.sent).toHaveLength(1);
  vi.advanceTimersByTime(99);
  expect(rpc.pendingCount).toBe(1);
  vi.advanceTimersByTime(1);
  await timedOut;
  expect(rpc.pendingCount).toBe(0);
  rpc.stop();
});

it('rejects requests on connection loss, never replays them, and ignores late responses', async () => {
  const { rpc, channel } = setup();
  const request = rpc.request({ method: 'sendMessage' });
  const lost = expect(request).rejects.toMatchObject({ kind: 'disconnected' });
  channel.transition('backoff');
  await lost;
  channel.transition('ready');
  channel.receive({ id: 'rpc-1', result: 'late' });
  expect(channel.sent).toHaveLength(1);
  expect(rpc.pendingCount).toBe(0);
  rpc.stop();
});

it('keeps matching errors as application errors but accepts them for a liveness probe', async () => {
  const { rpc, channel } = setup();
  const response = {
    error: { code: 500, message: 'handler failed', data: { retry: false } },
  };
  const request = rpc.request({ method: 'getUserInfo' });
  const rejected = expect(request).rejects.toBeInstanceOf(RpcResponseError);
  channel.receive({ id: 'rpc-1', ...response });
  await rejected;
  const probe = rpc.probe({ method: 'ping' });
  channel.receive({ id: 'rpc-2', ...response });
  await expect(probe).resolves.toBeUndefined();
  rpc.stop();
});

it('does not mistake a same-ID request-shaped frame for a response', async () => {
  const { rpc, channel } = setup({ timeoutMs: 10 });
  const request = rpc.request({ method: 'getUserInfo' });
  const rejected = expect(request).rejects.toMatchObject({ kind: 'timeout' });
  channel.receive({ id: 'rpc-1', method: 'ping' });
  expect(rpc.pendingCount).toBe(1);
  vi.advanceTimersByTime(10);
  await rejected;
  rpc.stop();
});

it('rejects immediate write failures and clears timers', async () => {
  const { rpc, channel } = setup();
  channel.send.mockReturnValue(false);
  await expect(rpc.request({ method: 'sendMessage' })).rejects.toMatchObject({
    kind: 'send',
  });
  await expect(rpc.notify({ method: 'messageTyped' })).rejects.toMatchObject({
    kind: 'send',
  });
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  rpc.stop();
});

it('shares capacity between waiting requests and notifications and releases all work on stop', async () => {
  const { rpc, channel } = setup({ maxPending: 2 }, 'connecting');
  const first = rpc.request({ method: 'getUserInfo' });
  const notification = rpc.notify({ method: 'messageTyped' });
  await expect(rpc.request({ method: 'overflow' })).rejects.toMatchObject({
    kind: 'capacity',
  });
  const results = Promise.allSettled([first, notification]);
  rpc.stop();
  expect((await results).every(({ status }) => status === 'rejected')).toBe(
    true,
  );
  expect(channel.subscriptions).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await expect(rpc.request({ method: 'afterStop' })).rejects.toMatchObject({
    kind: 'stopped',
  });
});
