import { describe, expect, it, vi } from 'vitest';

import { BrowserNetMonitor } from '../../../net-monitor/src/index.js';
import { createRealtimeClient, RealtimeClient } from '../index.js';

function makeConnectivity(initial = 'online') {
  let state = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (state === next) return;
      state = next;
      for (const listener of [...listeners]) listener(state);
    },
    get subscriberCount() {
      return listeners.size;
    },
  };
}

function makeClient({
  connectivity,
  retry = null,
  scheduler,
  connectTimeoutMs,
  logger,
} = {}) {
  const attempts = [];
  const client = createRealtimeClient({
    connectivity,
    retry,
    scheduler,
    connectTimeoutMs,
    logger,
    createTransport: () => {
      const transport = {
        handlers: null,
        sent: [],
        disposed: 0,
        start(handlers) {
          this.handlers = handlers;
        },
        send(message) {
          this.sent.push(message);
        },
        [Symbol.dispose]() {
          this.disposed++;
        },
      };
      attempts.push(transport);
      return transport;
    },
  });
  return { client, attempts };
}

describe('RealtimeClient connectivity', () => {
  it('includes optimistic online connectivity before the first source update', () => {
    const { client } = makeClient({ connectivity: makeConnectivity() });
    const snapshot = client.snapshot;
    expect(snapshot).toMatchObject({
      value: 'idle',
      connectivity: 'online',
      suspended: false,
    });
    expect(client.snapshot).toBe(snapshot);
    client.stop();
  });

  it('advances versions only when observed snapshot fields change', () => {
    const connectivity = makeConnectivity('online');
    const { client } = makeClient({ connectivity });
    const initial = client.snapshot;
    connectivity.set('offline');
    const offline = client.snapshot;
    expect(offline.version).toBeGreaterThan(initial.version);
    expect(client.snapshot).toBe(offline);
    connectivity.set('offline');
    expect(client.snapshot).toBe(offline);
    connectivity.set('online');
    expect(client.snapshot.version).toBeGreaterThan(offline.version);
    client.stop();
  });

  it('does not deliver a stale connectivity snapshot after listener re-entry', () => {
    const connectivity = makeConnectivity('online');
    const { client } = makeClient({ connectivity });
    const later = vi.fn();
    client.subscribe((snapshot) => {
      if (snapshot.connectivity === 'offline') connectivity.set('online');
    });
    client.subscribe(later);
    connectivity.set('offline');
    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0][0]).toMatchObject({ connectivity: 'online' });
    client.stop();
  });

  it('adds stable observed fields and blocks attempts while offline', () => {
    const connectivity = makeConnectivity('offline');
    const { client, attempts } = makeClient({ connectivity });
    const initial = client.snapshot;
    expect(initial).toMatchObject({
      value: 'idle',
      connectivity: 'offline',
      suspended: false,
    });
    expect(client.snapshot).toBe(initial);

    client.connect();
    expect(attempts).toHaveLength(0);
    expect(client.snapshot).toMatchObject({ suspended: true });
    client.reconnect();
    expect(attempts).toHaveLength(0);
    expect(client.state).toBe('idle');

    connectivity.set('online');
    expect(attempts).toHaveLength(1);
    expect(client.state).toBe('connecting');
    client.stop();
  });

  it('retires a ready attempt synchronously and ignores its late callbacks', () => {
    const connectivity = makeConnectivity('online');
    const { client, attempts } = makeClient({ connectivity });
    client.connect();
    const transport = attempts[0];
    transport.handlers.onOpen();
    expect(client.state).toBe('ready');

    connectivity.set('offline');
    expect(transport.disposed).toBe(1);
    expect(client.snapshot).toMatchObject({
      value: 'idle',
      connectivity: 'offline',
      suspended: true,
    });
    expect(client.send('blocked')).toBe(false);
    transport.handlers.onOpen();
    transport.handlers.onClose({ clean: false });
    expect(client.state).toBe('idle');
    expect(attempts).toHaveLength(1);

    connectivity.set('online');
    expect(attempts).toHaveLength(2);
    expect(client.state).toBe('connecting');
    client.stop();
  });

  it('preserves retry count across suspension and resumes backoff immediately', () => {
    const connectivity = makeConnectivity('online');
    const scheduled = [];
    const retry = {
      schedule: vi.fn((attempt, callback) => {
        const entry = { attempt, callback, cancelled: false };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      }),
    };
    const { client, attempts } = makeClient({ connectivity, retry });
    client.connect();
    attempts[0].handlers.onClose({ clean: false });
    expect(client.snapshot.context.attempt).toBe(1);
    expect(scheduled[0].attempt).toBe(1);

    connectivity.set('offline');
    expect(client.snapshot).toMatchObject({ value: 'idle', suspended: true });
    expect(scheduled[0].cancelled).toBe(true);
    connectivity.set('online');
    expect(client.snapshot.context.attempt).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(client.state).toBe('connecting');
    client.stop();
  });

  it('keeps an online backoff retry after a repeated online hint', () => {
    const listeners = new Set();
    const connectivity = {
      getSnapshot: () => 'online',
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit(state) {
        for (const listener of [...listeners]) listener(state);
      },
    };
    const scheduled = [];
    const retry = {
      schedule: (_attempt, callback) => {
        const entry = { callback, cancelled: false };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    };
    const { client, attempts } = makeClient({ connectivity, retry });
    client.connect();
    attempts[0].handlers.onClose({ clean: false });
    expect(client.state).toBe('backoff');

    connectivity.emit('online');
    expect(scheduled[0].cancelled).toBe(false);
    expect(client.state).toBe('backoff');
    scheduled[0].callback();
    expect(attempts).toHaveLength(2);
    expect(client.state).toBe('connecting');
    client.stop();
  });

  it('allows one recovery after a close before offline when retries are disabled', () => {
    const connectivity = makeConnectivity('online');
    const { client, attempts } = makeClient({ connectivity, retry: null });
    client.connect();
    attempts[0].handlers.onClose({ clean: false });
    expect(client.state).toBe('idle');
    expect(client.snapshot.suspended).toBe(false);

    connectivity.set('offline');
    expect(client.snapshot.suspended).toBe(true);
    connectivity.set('online');
    expect(attempts).toHaveLength(2);
    attempts[1].handlers.onClose({ clean: false });
    expect(client.state).toBe('idle');
    connectivity.set('offline');
    connectivity.set('online');
    expect(attempts).toHaveLength(3);

    attempts[2].handlers.onClose({ clean: false });
    client.connect();
    expect(attempts).toHaveLength(4);
    client.stop();
  });

  it('suspends when the source turns offline during connecting publication', () => {
    const connectivity = makeConnectivity('online');
    const { client, attempts } = makeClient({ connectivity });
    const unsubscribe = client.subscribe((snapshot) => {
      if (snapshot.value === 'connecting') connectivity.set('offline');
    });
    client.connect();
    expect(attempts).toHaveLength(0);
    expect(client.state).toBe('idle');
    expect(client.snapshot).toMatchObject({
      connectivity: 'offline',
      suspended: true,
    });
    unsubscribe();
    client.stop();
  });

  it('starts one attempt after offline-online reentry during connecting publication', () => {
    const connectivity = makeConnectivity('online');
    const { client, attempts } = makeClient({ connectivity });
    let reentered = false;
    const later = vi.fn();
    client.subscribe((snapshot) => {
      if (snapshot.value !== 'connecting' || reentered) return;
      reentered = true;
      connectivity.set('offline');
      connectivity.set('online');
    });
    client.subscribe(later);

    client.connect();

    expect(attempts).toHaveLength(1);
    expect(client.state).toBe('connecting');
    expect(client.snapshot).toMatchObject({
      value: 'connecting',
      connectivity: 'online',
      suspended: false,
    });
    expect(later).toHaveBeenCalled();
    expect(later.mock.calls.at(-1)[0]).toBe(client.snapshot);
    client.stop();
  });

  it('rejects invalid source callbacks without changing the snapshot', () => {
    const listeners = new Set();
    const connectivity = {
      getSnapshot: () => 'online',
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(state) {
        for (const listener of [...listeners]) listener(state);
      },
    };
    const logger = { warn: vi.fn() };
    const { client } = makeClient({ connectivity, logger });
    const before = client.snapshot;
    connectivity.set('unknown');
    expect(client.snapshot).toBe(before);
    expect(logger.warn).toHaveBeenCalledOnce();
    client.stop();
  });

  it('keeps a stopped client terminal after a valid recovery hint', () => {
    const connectivity = makeConnectivity('offline');
    const { client, attempts } = makeClient({ connectivity });
    client.connect();
    connectivity.set('online');
    expect(attempts).toHaveLength(1);
    connectivity.set('offline');
    client.stop();
    connectivity.set('online');
    expect(attempts).toHaveLength(1);
    expect(client.state).toBe('stopped');
  });

  it('keeps manual disconnect from starting after online recovery', () => {
    const connectivity = makeConnectivity('offline');
    const { client, attempts } = makeClient({ connectivity });
    client.connect();
    client.disconnect();
    connectivity.set('online');
    expect(client.snapshot).toMatchObject({ value: 'idle', suspended: false });
    expect(attempts).toHaveLength(0);
    client.stop();
  });

  it('blocks transport creation when the monitor samples offline at startup', () => {
    const connectivity = new BrowserNetMonitor({
      platform: {
        navigator: { onLine: false },
        addEventListener() {},
        removeEventListener() {},
      },
    });
    const attempts = [];
    const client = createRealtimeClient({
      connectivity,
      createTransport: () => {
        attempts.push(true);
        return { start() {}, send() {}, [Symbol.dispose]() {} };
      },
    });

    client.connect();

    expect(client.snapshot).toMatchObject({
      value: 'idle',
      connectivity: 'offline',
      suspended: true,
    });
    expect(attempts).toHaveLength(0);
    client.stop();
    connectivity.stop();
  });

  it('borrows a shared source and releases only its own subscription on stop', () => {
    const connectivity = makeConnectivity('online');
    const first = makeClient({ connectivity });
    const second = makeClient({ connectivity });
    expect(connectivity.subscriberCount).toBe(2);
    first.client.stop();
    expect(connectivity.subscriberCount).toBe(1);
    connectivity.set('offline');
    expect(second.client.snapshot).toMatchObject({
      value: 'idle',
      connectivity: 'offline',
    });
    second.client.stop();
    expect(connectivity.subscriberCount).toBe(0);
  });

  it('subscribes before sampling and cleans up when the first snapshot fails', () => {
    const order = [];
    const unsubscribeSource = vi.fn();
    const unsubscribeFsm = vi.fn();
    const events = { stop: vi.fn(), emit: vi.fn(), on: vi.fn(() => () => {}) };
    const fsm = {
      state: 'idle',
      snapshot: {
        value: 'idle',
        previousValue: null,
        context: { attempt: 0 },
        version: 0,
      },
      send: vi.fn(),
      subscribe: vi.fn(() => unsubscribeFsm),
    };
    const source = {
      subscribe(listener) {
        order.push('subscribe');
        listener('offline');
        return unsubscribeSource;
      },
      getSnapshot() {
        order.push('snapshot');
        throw new Error('snapshot failed');
      },
    };
    expect(
      () =>
        new RealtimeClient({
          fsm,
          events,
          createTransport: () => ({}),
          connectivity: source,
        }),
    ).toThrow('snapshot failed');
    expect(order).toEqual(['subscribe', 'snapshot']);
    expect(unsubscribeSource).toHaveBeenCalledOnce();
    expect(unsubscribeFsm).toHaveBeenCalledOnce();
    expect(events.stop).toHaveBeenCalledOnce();
  });

  it('cleans up Realtime setup when a borrowed monitor cannot read its state', () => {
    const platformListeners = new Map();
    const platform = {
      addEventListener(type, listener) {
        const current = platformListeners.get(type) ?? new Set();
        current.add(listener);
        platformListeners.set(type, current);
      },
      removeEventListener(type, listener) {
        platformListeners.get(type)?.delete(listener);
      },
    };
    const connectivity = new BrowserNetMonitor({ platform });
    const unsubscribeFsm = vi.fn();
    const events = { stop: vi.fn(), emit: vi.fn(), on: vi.fn(() => () => {}) };
    const fsm = {
      state: 'idle',
      snapshot: {
        value: 'idle',
        previousValue: null,
        context: { attempt: 0 },
        version: 0,
      },
      send: vi.fn(),
      subscribe: vi.fn(() => unsubscribeFsm),
    };

    expect(
      () =>
        new RealtimeClient({
          fsm,
          events,
          createTransport: () => ({}),
          connectivity,
        }),
    ).toThrow(
      new TypeError('navigator.onLine is unavailable or is not a boolean'),
    );
    expect(platformListeners.get('online')?.size ?? 0).toBe(0);
    expect(platformListeners.get('offline')?.size ?? 0).toBe(0);
    expect(unsubscribeFsm).toHaveBeenCalledOnce();
    expect(events.stop).toHaveBeenCalledOnce();
  });

  it.each([
    'connected',
    'unknown',
  ])('rejects invalid initial source state %s and releases client setup', (state) => {
    const unsubscribeSource = vi.fn();
    const unsubscribeFsm = vi.fn();
    const events = { stop: vi.fn(), emit: vi.fn(), on: vi.fn(() => () => {}) };
    const fsm = {
      state: 'idle',
      snapshot: {
        value: 'idle',
        previousValue: null,
        context: { attempt: 0 },
        version: 0,
      },
      send: vi.fn(),
      subscribe: vi.fn(() => unsubscribeFsm),
    };
    const source = {
      subscribe: () => unsubscribeSource,
      getSnapshot: () => state,
    };
    expect(
      () =>
        new RealtimeClient({
          fsm,
          events,
          createTransport: () => ({}),
          connectivity: source,
        }),
    ).toThrow(/invalid state/);
    expect(unsubscribeSource).toHaveBeenCalledOnce();
    expect(unsubscribeFsm).toHaveBeenCalledOnce();
    expect(events.stop).toHaveBeenCalledOnce();
  });

  it('accepts a synchronous source callback before its initial sample', () => {
    const order = [];
    const source = {
      subscribe(listener) {
        order.push('subscribe');
        listener('offline');
        return () => order.push('unsubscribe');
      },
      getSnapshot() {
        order.push('snapshot');
        return 'offline';
      },
    };
    const { client, attempts } = makeClient({ connectivity: source });
    expect(order).toEqual(['subscribe', 'snapshot']);
    expect(client.snapshot).toMatchObject({
      connectivity: 'offline',
      suspended: false,
    });
    client.connect();
    expect(client.snapshot.suspended).toBe(true);
    expect(attempts).toHaveLength(0);
    client.stop();
    expect(order.at(-1)).toBe('unsubscribe');
  });

  it('does not start a transport when its factory makes the source offline', () => {
    const connectivity = makeConnectivity('online');
    const transports = [];
    const client = createRealtimeClient({
      connectivity,
      retry: null,
      createTransport: () => {
        const transport = {
          disposed: 0,
          start: vi.fn(),
          send: vi.fn(),
          [Symbol.dispose]() {
            this.disposed++;
          },
        };
        transports.push(transport);
        connectivity.set('offline');
        return transport;
      },
    });
    client.connect();
    expect(transports).toHaveLength(1);
    expect(transports[0].start).not.toHaveBeenCalled();
    expect(transports[0].disposed).toBe(1);
    expect(client.snapshot).toMatchObject({ value: 'idle', suspended: true });
    client.stop();
  });

  it('ignores a canceled retry callback after offline suspension', () => {
    const connectivity = makeConnectivity('online');
    let retryCallback;
    const retry = {
      schedule: (_attempt, callback) => {
        retryCallback = callback;
        return vi.fn();
      },
    };
    const { client, attempts } = makeClient({ connectivity, retry });
    client.connect();
    attempts[0].handlers.onClose({ clean: false });
    connectivity.set('offline');
    retryCallback();
    expect(client.state).toBe('idle');
    expect(attempts).toHaveLength(1);
    client.stop();
  });

  it('lets disconnect or stop win during recovery state publication', () => {
    for (const command of ['disconnect', 'stop']) {
      const connectivity = makeConnectivity('offline');
      const { client, attempts } = makeClient({ connectivity });
      client.connect();
      connectivity.set('online');
      expect(attempts).toHaveLength(1);
      connectivity.set('offline');
      const unsubscribe = client.subscribe((snapshot) => {
        if (
          snapshot.value === 'connecting' &&
          snapshot.connectivity === 'online'
        )
          client[command]();
      });
      connectivity.set('online');
      expect(attempts).toHaveLength(1);
      expect(client.state).toBe(command === 'stop' ? 'stopped' : 'idle');
      unsubscribe();
      client.stop();
    }
  });

  it('lets a nested online hint start a new attempt during old transport disposal', () => {
    const connectivity = makeConnectivity('online');
    const { client, attempts } = makeClient({ connectivity });
    client.connect();
    attempts[0].handlers.onOpen();
    attempts[0][Symbol.dispose] = () => {
      attempts[0].disposed++;
      connectivity.set('online');
    };

    connectivity.set('offline');
    expect(attempts[0].disposed).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(client.state).toBe('connecting');
    expect(client.snapshot).toMatchObject({
      connectivity: 'online',
      suspended: false,
    });
    client.stop();
  });

  it('clears an old timeout only after offline commits and ignores its stale callback', () => {
    const connectivity = makeConnectivity('online');
    const timers = [];
    let returnOnlineOnClear = false;
    const scheduler = {
      setTimeout(callback) {
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) {
        timer.cleared = true;
        if (returnOnlineOnClear) {
          returnOnlineOnClear = false;
          connectivity.set('online');
        }
      },
    };
    const { client, attempts } = makeClient({
      connectivity,
      scheduler,
      connectTimeoutMs: 1000,
    });
    client.connect();
    returnOnlineOnClear = true;
    connectivity.set('offline');
    expect(timers[0].cleared).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(client.state).toBe('connecting');
    timers[0].callback();
    expect(client.state).toBe('connecting');
    expect(attempts).toHaveLength(2);
    client.stop();
  });

  it('resets retry history when a suspended idle connection is disconnected', () => {
    const connectivity = makeConnectivity('online');
    const scheduled = [];
    const retry = {
      schedule: (attempt, callback) => {
        const entry = { attempt, callback, cancelled: false };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    };
    const { client, attempts } = makeClient({ connectivity, retry });
    client.connect();
    attempts[0].handlers.onClose({ clean: false });
    connectivity.set('offline');
    expect(client.snapshot.context.attempt).toBe(1);
    client.disconnect();
    expect(client.snapshot.context.attempt).toBe(0);
    connectivity.set('online');
    expect(attempts).toHaveLength(1);
    client.stop();
  });

  it('commits manual disconnect before cleanup can publish offline', () => {
    const connectivity = makeConnectivity('online');
    const scheduled = [];
    const retry = {
      schedule: (_attempt, callback) => {
        scheduled.push(callback);
        return () => {};
      },
    };
    const { client, attempts } = makeClient({ connectivity, retry });
    client.connect();
    attempts[0].handlers.onClose({ clean: false });
    expect(client.snapshot.context.attempt).toBe(1);
    scheduled[0]();
    expect(attempts).toHaveLength(2);
    attempts[1][Symbol.dispose] = () => connectivity.set('offline');

    client.disconnect();
    expect(client.snapshot).toMatchObject({
      value: 'idle',
      connectivity: 'offline',
      suspended: false,
      context: { attempt: 0 },
    });
    expect(attempts).toHaveLength(2);
    client.stop();
  });
});
