import { describe, expect, it, vi } from 'vitest';

import { createRealtimeClient, RealtimeClient } from '../index.js';

function makeConnectivity(initial = 'unknown') {
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
} = {}) {
  const attempts = [];
  const client = createRealtimeClient({
    connectivity,
    retry,
    scheduler,
    connectTimeoutMs,
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
  it('includes unknown connectivity fields before the first source update', () => {
    const { client } = makeClient({ connectivity: makeConnectivity() });
    const snapshot = client.snapshot;
    expect(snapshot).toMatchObject({
      value: 'idle',
      connectivity: 'unknown',
      suspended: false,
    });
    expect(client.snapshot).toBe(snapshot);
    client.stop();
  });

  it('advances versions only when observed snapshot fields change', () => {
    const connectivity = makeConnectivity('online');
    const { client } = makeClient({ connectivity });
    const initial = client.snapshot;
    connectivity.set('unknown');
    const unknown = client.snapshot;
    expect(unknown.version).toBeGreaterThan(initial.version);
    expect(client.snapshot).toBe(unknown);
    connectivity.set('unknown');
    expect(client.snapshot).toBe(unknown);
    connectivity.set('offline');
    expect(client.snapshot.version).toBeGreaterThan(unknown.version);
    client.stop();
  });

  it('does not deliver a stale connectivity snapshot after listener re-entry', () => {
    const connectivity = makeConnectivity('online');
    const { client } = makeClient({ connectivity });
    const later = vi.fn();
    client.subscribe((snapshot) => {
      if (snapshot.connectivity === 'unknown') connectivity.set('offline');
    });
    client.subscribe(later);
    connectivity.set('unknown');
    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0][0]).toMatchObject({ connectivity: 'offline' });
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

  it('starts an attempt after a source-only update during connecting publication', () => {
    const connectivity = makeConnectivity('unknown');
    const { client, attempts } = makeClient({ connectivity });
    const unsubscribe = client.subscribe((snapshot) => {
      if (
        snapshot.value === 'connecting' &&
        snapshot.connectivity === 'unknown'
      )
        connectivity.set('online');
    });
    client.connect();
    expect(attempts).toHaveLength(1);
    expect(client.state).toBe('connecting');
    unsubscribe();
    client.stop();
  });

  it('accelerates a nonsuspended backoff when an online hint arrives', () => {
    const connectivity = makeConnectivity('unknown');
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
    connectivity.set('online');
    expect(scheduled[0].cancelled).toBe(true);
    expect(attempts).toHaveLength(2);
    client.stop();
  });

  it('keeps unknown suspended until an explicit connect, and stop is terminal', () => {
    const connectivity = makeConnectivity('offline');
    const { client, attempts } = makeClient({ connectivity });
    client.connect();
    connectivity.set('unknown');
    expect(client.snapshot).toMatchObject({ value: 'idle', suspended: true });
    expect(attempts).toHaveLength(0);
    client.connect();
    expect(attempts).toHaveLength(1);
    connectivity.set('offline');
    client.stop();
    connectivity.set('online');
    expect(attempts).toHaveLength(1);
    expect(client.state).toBe('stopped');
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

  it('rejects an invalid initial source state and releases the source and client setup', () => {
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
      getSnapshot: () => 'connected',
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
