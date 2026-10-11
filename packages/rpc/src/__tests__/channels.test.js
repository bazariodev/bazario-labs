import { createRealtimeClient, JsonTransport } from '@bazariodev/realtime';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RpcClient } from '../index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('uses direct flat JSON RPC frames and ignores malformed incoming values', async () => {
  let handlers;
  const sent = [];
  const raw = {
    start(value) {
      handlers = value;
    },
    send(frame) {
      sent.push(JSON.parse(frame));
    },
    [Symbol.dispose]() {},
  };
  const realtime = createRealtimeClient({
    createTransport: () => new JsonTransport(raw),
    retry: null,
  });
  const rpc = new RpcClient({
    channel: realtime,
    createRequestId: () => 'rpc-1',
  });
  const request = rpc.request({ method: 'getUserInfo', params: { id: 1 } });
  realtime.connect();
  handlers.onOpen();

  expect(sent).toEqual([
    { id: 'rpc-1', method: 'getUserInfo', params: { id: 1 } },
  ]);
  handlers.onMessage(JSON.stringify({ id: 'rpc-1', result: { name: 'Alex' } }));
  await expect(request).resolves.toEqual({ name: 'Alex' });

  const notifications = [];
  rpc.onNotification((value) => notifications.push(value));
  await rpc.notify({ method: 'messageTyped', params: { typing: true } });
  expect(sent[1]).toEqual({ method: 'messageTyped', params: { typing: true } });
  handlers.onMessage(
    JSON.stringify({
      method: 'message',
      params: { text: 'hi' },
      ts: 42,
      eventId: 'evt-1',
    }),
  );
  for (const invalid of [
    null,
    false,
    1,
    'text',
    [],
    { id: 1, result: true },
    { id: null, method: 'bad' },
  ])
    handlers.onMessage(JSON.stringify(invalid));
  expect(notifications).toEqual([
    { method: 'message', params: { text: 'hi' }, ts: 42, eventId: 'evt-1' },
  ]);
  expect(realtime.state).toBe('ready');
  expect(rpc.pendingCount).toBe(0);
  rpc.stop();
  realtime.stop();
});

it('uses correlated RPC probes and replaces a half-open connection without a close event', async () => {
  let handlers;
  let retryCallback;
  let rpc;
  let nextProbeId = 0;
  let answerProbe = true;
  const attempts = [];
  const realtime = createRealtimeClient({
    createTransport() {
      const attempt = {
        disposed: false,
        closeEvents: 0,
        sent: [],
        start(value) {
          handlers = value;
          this.handlers = value;
        },
        send(frame) {
          const message = JSON.parse(frame);
          this.sent.push(message);
          if (answerProbe && message.method === 'ping')
            handlers.onMessage(
              JSON.stringify({ id: message.id, error: { code: 500 } }),
            );
        },
        [Symbol.dispose]() {
          this.disposed = true;
        },
      };
      attempts.push(attempt);
      return new JsonTransport(attempt);
    },
    retry: {
      schedule(_attempt, callback) {
        retryCallback = callback;
        return () => {};
      },
    },
    keepalive: {
      idleMs: 20,
      deadlineMs: 10,
      probe: (signal) => rpc.probe({ method: 'ping' }, { signal }),
    },
  });
  rpc = new RpcClient({
    channel: realtime,
    createRequestId: () => `probe-${++nextProbeId}`,
  });
  realtime.connect();
  const old = attempts[0];
  old.handlers.onOpen();
  await vi.advanceTimersByTimeAsync(20);
  expect(old.sent).toEqual([{ id: 'probe-1', method: 'ping' }]);
  expect(rpc.pendingCount).toBe(0);

  answerProbe = false;
  realtime.probeNow();
  const activeProbe = rpc.pendingCount;
  old.handlers.onMessage(
    JSON.stringify({ id: 'probe-1', error: { code: 500 } }),
  );
  expect(rpc.pendingCount).toBe(activeProbe);
  old.handlers.onMessage(
    JSON.stringify({ method: 'unrelated', params: { ok: true } }),
  );
  expect(rpc.pendingCount).toBe(activeProbe);
  await vi.advanceTimersByTimeAsync(10);
  expect(realtime.state).toBe('backoff');
  expect(old.disposed).toBe(true);
  expect(old.closeEvents).toBe(0);
  expect(rpc.pendingCount).toBe(0);

  retryCallback();
  const replacement = attempts[1];
  replacement.handlers.onOpen();
  old.handlers.onClose({ clean: false });
  expect(realtime.state).toBe('ready');
  expect(replacement.disposed).toBe(false);
  rpc.stop();
  realtime.stop();
  expect(attempts.every(({ disposed }) => disposed)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases sent calls on reconnect and stop, and ignores old frames', async () => {
  const attempts = [];
  const realtime = createRealtimeClient({
    createTransport() {
      const attempt = {
        sent: [],
        start(handlers) {
          this.handlers = handlers;
        },
        send(message) {
          this.sent.push(message);
        },
        [Symbol.dispose]() {},
      };
      attempts.push(attempt);
      return attempt;
    },
    retry: null,
  });
  let nextId = 0;
  const rpc = new RpcClient({
    channel: realtime,
    createRequestId: () => `request-${++nextId}`,
  });
  realtime.connect();
  attempts[0].handlers.onOpen();
  const interrupted = rpc.request({ method: 'first' });
  const interruptedResult = expect(interrupted).rejects.toMatchObject({
    kind: 'disconnected',
  });
  realtime.reconnect();
  await interruptedResult;

  attempts[1].handlers.onOpen();
  const current = rpc.request({ method: 'second' });
  const currentResult = expect(current).resolves.toBe('current');
  attempts[0].handlers.onMessage({ id: 'request-1', result: 'stale' });
  expect(rpc.pendingCount).toBe(1);
  attempts[1].handlers.onMessage({ id: 'request-2', result: 'current' });
  await currentResult;

  const stopped = rpc.request({ method: 'third' });
  const stoppedResult = expect(stopped).rejects.toMatchObject({
    kind: 'stopped',
  });
  realtime.stop();
  await stoppedResult;
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  rpc.stop();
});

it('starts inert when RPC is built on an already stopped client', async () => {
  const realtime = createRealtimeClient({ createTransport: () => ({}) });
  realtime.stop();
  const rpc = new RpcClient({ channel: realtime });

  await expect(rpc.request({ method: 'afterStop' })).rejects.toMatchObject({
    kind: 'stopped',
  });
  expect(rpc.pendingCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  rpc.stop();
});
