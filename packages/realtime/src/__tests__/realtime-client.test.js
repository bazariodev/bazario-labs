import { WebSocketAdapter } from '@bazariodev/transport';
import { expect, it, vi } from 'vitest';
import { RealtimeClient as CoreRealtimeClient } from '../core.js';
import {
  createRealtimeClient,
  JsonTransport,
  RealtimeClient,
} from '../index.js';
import { createScheduler, StubTransport } from './direct-client-helpers.js';

it('uses JSON only when the factory selects JsonTransport', () => {
  const transports = [];
  const client = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      transports.push(transport);
      return new JsonTransport(transport);
    },
    retry: null,
  });
  const messages = [];
  client.onMessage((message) => messages.push(message));
  client.connect();
  transports[0].open();
  const payload = { id: 'r1', result: { newField: true } };
  transports[0].receive(JSON.stringify(payload));

  expect(client.send({ id: 'r2', method: 'ping', params: null })).toBe(true);
  expect(transports[0].sent).toEqual([
    '{"id":"r2","method":"ping","params":null}',
  ]);
  expect(messages).toEqual([payload]);
  client.stop();
});

it('does not leave a WebSocket alive when URL resolution withdraws connection intent', () => {
  const sockets = [];
  let client;
  class FakeWebSocket {
    readyState = 0;
    bufferedAmount = 0;

    constructor(url) {
      this.url = url;
      sockets.push(this);
    }

    close() {
      this.readyState = 2;
    }

    send() {}
  }

  client = createRealtimeClient({
    createTransport: () =>
      new JsonTransport(
        new WebSocketAdapter({
          WebSocket: FakeWebSocket,
          url() {
            client.disconnect();
            return 'ws://example.test';
          },
        }),
      ),
    retry: null,
  });

  client.connect();
  expect(client.state).toBe('idle');
  client.stop();

  expect(client.state).toBe('stopped');
  expect(sockets).toEqual([]);
});

it('keeps an open WebSocket diagnostic from retiring a newer attempt', () => {
  const sockets = [];
  class FakeWebSocket {
    readyState = 0;
    bufferedAmount = 0;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {
      this.readyState = 2;
    }
  }
  const client = createRealtimeClient({
    createTransport: () =>
      new WebSocketAdapter({
        url: 'ws://example.test',
        WebSocket: FakeWebSocket,
      }),
    retry: null,
  });
  let replaceOnError = false;
  client.onError(() => {
    if (replaceOnError) client.reconnect();
  });
  client.connect();
  const oldSocket = sockets[0];
  oldSocket.readyState = 1;
  oldSocket.onopen();
  const diagnostic = new Error('open socket diagnostic');
  oldSocket.onerror(diagnostic);

  expect(client.state).toBe('ready');
  expect(oldSocket.onclose).toEqual(expect.any(Function));
  replaceOnError = true;
  oldSocket.onerror(new Error('reentrant diagnostic'));

  expect(client.state).toBe('connecting');
  expect(sockets).toHaveLength(2);
  expect(oldSocket.onclose).toBeNull();
  expect(sockets[1].readyState).toBe(0);
  client.stop();
});

it('recovers from a closing WebSocket diagnostic without a native close event', () => {
  const sockets = [];
  const retries = [];
  class FakeWebSocket {
    readyState = 0;
    bufferedAmount = 0;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {
      this.readyState = 2;
    }
  }
  const client = createRealtimeClient({
    createTransport: () =>
      new WebSocketAdapter({
        url: 'ws://example.test',
        WebSocket: FakeWebSocket,
      }),
    retry: {
      schedule(attempt, callback) {
        retries.push({ attempt, callback });
        return () => {};
      },
    },
  });
  const errors = [];
  client.onError((cause) => errors.push(cause));
  client.connect();
  const socket = sockets[0];
  socket.readyState = 1;
  socket.onopen();
  socket.readyState = 3;
  const nativeClose = socket.onclose;

  socket.onerror(new Error('closed socket diagnostic'));

  expect(client.state).toBe('backoff');
  expect(retries).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(Error);
  expect(errors[1]).toEqual({ clean: false });
  nativeClose({ code: 1006, reason: '', wasClean: false });
  expect(client.state).toBe('backoff');
  retries[0].callback();
  expect(client.state).toBe('connecting');
  expect(sockets).toHaveLength(2);
  client.stop();
});

it('exports one core class and returns its instance from the factory', () => {
  const client = createRealtimeClient({
    createTransport: () => new StubTransport(),
    retry: null,
  });

  expect(CoreRealtimeClient).toBe(RealtimeClient);
  expect(client).toBeInstanceOf(RealtimeClient);
  client.stop();
});

it('skips malformed JSON without retiring the active connection', () => {
  const transport = new StubTransport();
  const warn = vi.fn();
  const client = createRealtimeClient({
    createTransport: () => new JsonTransport(transport, { warn }),
    retry: null,
    logger: { debug() {}, error() {}, warn },
  });
  const messages = [];
  client.onMessage((message) => messages.push(message));
  client.connect();
  transport.open();
  transport.receive('{');
  transport.receive(JSON.stringify(null));

  expect(client.state).toBe('ready');
  expect(messages).toEqual([null]);
  expect(warn).toHaveBeenCalledOnce();
  client.stop();
});

it('preserves raw typed messages when the factory does not select JSON', () => {
  const transport = new StubTransport();
  const client = createRealtimeClient({
    createTransport: () => transport,
    retry: null,
  });
  const payload = { custom: true };
  const received = [];
  client.onMessage((message) => received.push(message));
  client.connect();
  transport.open();

  expect(client.send(payload)).toBe(true);
  transport.receive(payload);

  expect(transport.sent[0]).toBe(payload);
  expect(received[0]).toBe(payload);
  client.stop();
});

it('does not write a serialized value after toJSON reconnects the client', () => {
  const transports = [];
  let client;
  client = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      transports.push(transport);
      return new JsonTransport(transport);
    },
    retry: null,
  });
  client.connect();
  transports[0].open();

  const accepted = client.send({
    toJSON() {
      client.reconnect();
      return { stale: true };
    },
  });

  expect(accepted).toBe(false);
  expect(transports[0].sent).toEqual([]);
  expect(transports[0].disposed).toBe(true);
  expect(transports).toHaveLength(2);
  expect(client.state).toBe('connecting');
  client.stop();
});

it('uses supplied retry and omits it when explicitly null', () => {
  const transport = new StubTransport();
  const retry = { schedule: vi.fn(() => () => {}) };
  const client = createRealtimeClient({
    createTransport: () => transport,
    retry,
  });
  client.connect();
  transport.close();
  expect(client.state).toBe('backoff');
  expect(retry.schedule).toHaveBeenCalledWith(1, expect.any(Function));
  client.stop();

  const noRetryTransports = [];
  const noRetry = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      noRetryTransports.push(transport);
      return transport;
    },
    retry: null,
  });
  noRetry.connect();
  noRetryTransports[0].close();
  expect(noRetry.state).toBe('idle');
  noRetry.connect();
  expect(noRetryTransports).toHaveLength(2);
  expect(noRetry.state).toBe('connecting');
  noRetry.stop();
});

it('creates Keepalive only when an abortable probe is configured', () => {
  const scheduler = createScheduler();
  const transport = new StubTransport();
  const probe = vi.fn(() => new Promise(() => {}));
  const client = createRealtimeClient({
    createTransport: () => transport,
    retry: null,
    scheduler,
    keepalive: { probe, idleMs: 5, deadlineMs: 10 },
  });
  client.connect();
  transport.open();
  scheduler.fire(scheduler.tasks.at(-1));

  expect(probe).toHaveBeenCalledOnce();
  client.stop();
  expect(probe.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  expect(transport.disposed).toBe(true);
  expect(scheduler.tasks.filter(({ cleared }) => !cleared)).toEqual([]);
});

it('replaces a half-open transport after liveness failure without a close event', () => {
  const scheduler = createScheduler();
  const transports = [];
  let retryCallback;
  const client = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      transports.push(transport);
      return transport;
    },
    retry: {
      schedule(_attempt, callback) {
        retryCallback = callback;
        return () => {};
      },
    },
    scheduler,
    keepalive: {
      idleMs: 5,
      deadlineMs: 10,
      probe: () => new Promise(() => {}),
    },
  });
  client.connect();
  const old = transports[0];
  old.open();
  scheduler.fire(scheduler.tasks.find(({ delayMs }) => delayMs === 5));
  scheduler.fire(
    scheduler.tasks.filter(({ delayMs }) => delayMs === 10).at(-1),
  );

  expect(client.state).toBe('backoff');
  expect(old.disposed).toBe(true);
  expect(old.closeEvents).toBe(0);

  old.close();
  retryCallback();
  expect(transports).toHaveLength(2);
  transports[1].open();
  old.close();

  expect(client.state).toBe('ready');
  expect(transports[1].disposed).toBe(false);
  client.stop();
  expect(transports.every(({ disposed }) => disposed)).toBe(true);
  expect(scheduler.tasks.filter(({ cleared }) => !cleared)).toEqual([]);
});

it.each([
  'reconnect',
  'disconnect',
  'stop',
])('lets abort cleanup command %s win during outer reconnect', (nested) =>
  runAbortCleanupCase('reconnect', nested));

it.each([
  'reconnect',
  'disconnect',
  'stop',
])('lets abort cleanup command %s win during monitor failure', (nested) =>
  runAbortCleanupCase('failure', nested));

it('uses supplied FSM, events, monitor factory, and transport factory', () => {
  const transport = new StubTransport();
  const monitor = {
    onFail: () => () => {},
    start: vi.fn(),
    probeNow() {},
    activity() {},
    stop: vi.fn(),
  };
  let state = 'idle';
  let snapshot = Object.freeze({
    value: state,
    previousValue: null,
    context: Object.freeze({ attempt: 0 }),
    version: 0,
  });
  const subscribers = new Set();
  const fsm = {
    get state() {
      return state;
    },
    get snapshot() {
      return snapshot;
    },
    send({ type }) {
      const next = {
        CONNECT: 'connecting',
        READY: 'ready',
        DISCONNECT: 'idle',
        STOP: 'stopped',
      }[type];
      if (!next) return;
      const previousValue = state;
      state = next;
      snapshot = Object.freeze({
        ...snapshot,
        value: state,
        previousValue,
        version: snapshot.version + 1,
      });
      for (const subscriber of [...subscribers]) subscriber(snapshot);
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
  const events = {
    listeners: new Map(),
    on(type, listener) {
      const set = this.listeners.get(type) ?? new Set();
      this.listeners.set(type, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(type, payload) {
      for (const listener of this.listeners.get(type) ?? []) listener(payload);
    },
    stop() {
      this.listeners.clear();
    },
  };
  const client = createRealtimeClient({
    createTransport: () => transport,
    fsm,
    events,
    retry: null,
    createKeepalive: () => monitor,
  });

  client.connect();
  transport.open();
  expect(monitor.start).toHaveBeenCalledOnce();
  client.stop();
  expect(monitor.stop).toHaveBeenCalledOnce();
  expect(subscribers.size).toBe(0);
});

it('rejects a missing raw transport factory', () => {
  expect(() => createRealtimeClient({})).toThrow(/createTransport/);
});

it('rejects explicit null lifecycle and event dependencies instead of selecting defaults', () => {
  for (const dependency of ['fsm', 'events']) {
    expect(() =>
      createRealtimeClient({
        createTransport: () => new StubTransport(),
        [dependency]: null,
      }),
    ).toThrow();
  }
});

function runAbortCleanupCase(outer, nested) {
  const scheduler = createScheduler();
  const transports = [];
  let client;
  let abortCount = 0;
  client = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      transports.push(transport);
      return transport;
    },
    retry: null,
    scheduler,
    keepalive: {
      idleMs: 5,
      deadlineMs: 10,
      probe(signal) {
        signal.addEventListener('abort', () => {
          abortCount++;
          client[nested]();
        });
        return new Promise(() => {});
      },
    },
  });
  client.connect();
  transports[0].open();
  client.probeNow();

  if (outer === 'reconnect') client.reconnect();
  else scheduler.fire(scheduler.tasks.at(-1));

  expect(abortCount).toBe(1);
  expect(transports[0].disposed).toBe(true);
  if (nested === 'reconnect') {
    expect(client.state).toBe('connecting');
    expect(transports).toHaveLength(2);
    expect(transports[1].disposed).toBe(false);
  } else if (nested === 'disconnect') {
    expect(client.state).toBe('idle');
    expect(transports).toHaveLength(1);
  } else {
    expect(client.state).toBe('stopped');
    expect(transports).toHaveLength(1);
  }
  client.stop();
  expect(transports.every(({ disposed }) => disposed)).toBe(true);
  expect(scheduler.tasks.filter(({ cleared }) => !cleared)).toEqual([]);
}
