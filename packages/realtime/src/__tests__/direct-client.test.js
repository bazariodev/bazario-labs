import { Emitter } from '@bazariodev/coordination';
import { Fsm } from '@bazariodev/fsm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFsmConfig } from '../fsm-config.js';
import { RealtimeClient } from '../realtime-client.js';
import {
  createClient,
  createScheduler,
  logger,
  StubTransport,
} from './direct-client-helpers.js';

afterEach(() => vi.useRealTimers());

describe('injected RealtimeClient', () => {
  it('reads current snapshots in earlier lifecycle subscribers without connectivity', () => {
    const fsm = new Fsm(createFsmConfig(logger));
    const transport = new StubTransport();
    const observations = [];
    let client;
    const unsubscribe = fsm.subscribe((snapshot) => {
      observations.push({
        expected: snapshot,
        actual: client.snapshot,
        state: client.state,
      });
    });
    client = new RealtimeClient({
      fsm,
      events: new Emitter({ logger }),
      createTransport: () => transport,
      logger,
    });

    try {
      client.connect();
      transport.open();
      client.disconnect();
      client.stop();

      expect(observations.map(({ state }) => state)).toEqual([
        'connecting',
        'ready',
        'idle',
        'stopped',
      ]);
      for (const { expected, actual, state } of observations) {
        expect(actual).toBe(expected);
        expect(actual.value).toBe(state);
      }
    } finally {
      client.stop();
      unsubscribe();
    }
  });

  it('forwards opaque messages to one injected transport unchanged', () => {
    const { client, transports } = createClient();
    const message = { type: 'ready', protocol: 99, data: { raw: true } };

    client.connect();
    transports[0].open();

    expect(client.state).toBe('ready');
    expect(client.send(message)).toBe(true);
    expect(transports[0].sent).toEqual([message]);
    expect(transports[0].sent[0]).toBe(message);
    client.stop();
  });

  it('uses onOpen as ready and starts the monitor before ready subscribers', () => {
    const order = [];
    const monitor = {
      onFail: () => () => order.push('unsubscribe'),
      start: () => order.push('monitor'),
      probeNow: () => order.push('probe'),
      activity() {},
      stop: () => order.push('stop'),
    };
    const { client, transports } = createClient({
      createKeepalive: () => monitor,
    });
    const ready = vi.fn((info) => order.push(info.reason));
    client.subscribe((snapshot) => {
      if (snapshot.value === 'ready') client.probeNow();
    });
    client.onReady(ready);

    client.connect();
    transports[0].open();
    transports[0].open();

    expect(order).toEqual(['monitor', 'probe', 'initial']);
    expect(ready).toHaveBeenCalledOnce();
    expect(client.snapshot.context).toEqual({ attempt: 0 });
    client.stop();
  });

  it('delivers one opaque message to the monitor and public listener', () => {
    const order = [];
    const payload = { id: 'any-shape', type: 'pong', value: 1 };
    const { client, transports } = createClient({
      createKeepalive({ onMessage }) {
        onMessage((message) => order.push(['monitor', message]));
        return {
          onFail: () => () => {},
          start() {},
          probeNow() {},
          activity() {
            order.push('activity');
          },
          stop() {},
        };
      },
    });
    client.onMessage((message) => order.push(['public', message]));
    client.connect();
    transports[0].open();
    transports[0].receive(payload);

    expect(order).toEqual([
      'activity',
      ['public', payload],
      ['monitor', payload],
    ]);
    client.stop();
  });

  it('does not send or probe before the active attempt is ready', () => {
    const monitor = {
      onFail: () => () => {},
      start() {},
      probeNow: vi.fn(),
      activity() {},
      stop() {},
    };
    const { client, transports } = createClient({
      createKeepalive: () => monitor,
    });
    const messages = [];
    client.onMessage((message) => messages.push(message));
    client.connect();
    expect(client.send('early')).toBe(false);
    client.probeNow();
    transports[0].receive('early');
    expect(monitor.probeNow).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
    transports[0].open();
    expect(client.send('ready')).toBe(true);
    expect(transports[0].sent).toEqual(['ready']);
    client.stop();
  });

  it('reports rejected sends without retiring the ready transport', () => {
    const cause = new Error('send failed');
    const { client, transports } = createClient();
    const errors = [];
    client.onError((error) => errors.push(error));
    client.connect();
    transports[0].open();
    transports[0].sendError = cause;

    expect(client.send({ opaque: true })).toBe(false);
    expect(client.state).toBe('ready');
    expect(transports[0].disposed).toBe(false);
    expect(errors).toEqual([cause]);
    client.stop();
  });

  it('keeps diagnostic transport errors separate from terminal close', () => {
    const { client, transports } = createClient();
    const errors = [];
    const messages = [];
    client.onError((error) => errors.push(error));
    client.onMessage((message) => messages.push(message));
    client.connect();
    const connectingError = new Error('connecting socket diagnostic');
    transports[0].fail(connectingError);

    expect(client.state).toBe('connecting');
    expect(transports[0].disposed).toBe(false);
    transports[0].open();
    const readyError = new Error('ready socket diagnostic');
    transports[0].fail(readyError);
    transports[0].receive('still usable');
    expect(client.send('still writable')).toBe(true);
    expect(client.state).toBe('ready');
    expect(transports[0].disposed).toBe(false);
    expect(messages).toEqual(['still usable']);
    expect(transports[0].sent).toEqual(['still writable']);
    expect(errors).toEqual([connectingError, readyError]);

    transports[0].close({ clean: false });
    expect(client.state).toBe('idle');
    expect(transports[0].disposed).toBe(true);
    client.stop();
  });

  it('keeps the newest reconnect when a diagnostic listener reenters', () => {
    const { client, transports } = createClient();
    client.onError(() => client.reconnect());
    client.connect();
    const old = transports[0];

    old.fail(new Error('diagnostic'));

    expect(client.state).toBe('connecting');
    expect(transports).toHaveLength(2);
    expect(old.disposed).toBe(true);
    expect(transports[1].disposed).toBe(false);
    old.close();
    expect(client.state).toBe('connecting');
    expect(transports[1].disposed).toBe(false);
    client.stop();
  });

  it('reports transport factory and start failures and stays restartable', () => {
    const cause = new Error('start failed');
    const transport = new StubTransport();
    transport.startError = cause;
    let creations = 0;
    const { client, transports } = createClient({
      createTransport() {
        creations++;
        const next = creations === 1 ? transport : new StubTransport();
        transports.push(next);
        return next;
      },
    });
    const errors = [];
    client.onError((error) => errors.push(error));

    client.connect();
    expect(client.state).toBe('idle');
    expect(errors).toEqual([cause]);
    expect(transport.disposed).toBe(true);
    client.connect();

    expect(transports).toHaveLength(2);
    expect(client.state).toBe('connecting');
    client.stop();
  });

  it('contains a synchronous transport factory throw and allows a manual restart', () => {
    const cause = new Error('transport factory failed');
    const transport = new StubTransport();
    let attempts = 0;
    const { client } = createClient({
      createTransport() {
        attempts++;
        if (attempts === 1) throw cause;
        return transport;
      },
    });
    const errors = [];
    client.onError((error) => errors.push(error));
    client.connect();

    expect(client.state).toBe('idle');
    expect(errors).toEqual([cause]);
    client.connect();
    expect(client.state).toBe('connecting');
    client.stop();
  });

  it('accepts a synchronous open callback from transport.start', () => {
    const transport = new StubTransport();
    transport.onStart = (handlers) => handlers.onOpen();
    const { client } = createClient({ createTransport: () => transport });
    const readies = [];
    client.onReady((info) => readies.push(info));

    client.connect();

    expect(client.state).toBe('ready');
    expect(readies).toEqual([{ reason: 'initial' }]);
    client.stop();
  });

  it('ignores a ready callback after start reenters disconnect', () => {
    let client;
    const transport = new StubTransport();
    transport.onStart = (handlers) => {
      client.disconnect();
      handlers.onOpen();
    };
    client = createClient({ createTransport: () => transport }).client;
    const ready = vi.fn();
    client.onReady(ready);

    client.connect();

    expect(client.state).toBe('idle');
    expect(transport.disposed).toBe(true);
    expect(ready).not.toHaveBeenCalled();
    client.stop();
  });

  it('lets a reconnect from transport disposal supersede disconnect', () => {
    let client;
    const transports = [];
    const createTransport = () => {
      const transport = new StubTransport();
      transports.push(transport);
      if (transports.length === 1)
        transport.onDispose = () => client.reconnect();
      return transport;
    };
    client = createClient({ createTransport }).client;
    client.connect();
    transports[0].open();

    client.disconnect();

    expect(client.state).toBe('connecting');
    expect(transports).toHaveLength(2);
    expect(transports[0].disposed).toBe(true);
    expect(transports[1].disposed).toBe(false);
    client.stop();
  });

  it('increments retry count from the FSM and ignores a queued old retry', () => {
    const retries = [];
    const retry = {
      schedule(attempt, callback) {
        const record = { attempt, callback, cancelled: false };
        retries.push(record);
        return () => {
          record.cancelled = true;
        };
      },
    };
    const { client, transports, fsm } = createClient({ retry });
    client.connect();
    transports[0].close();
    expect(client.state).toBe('backoff');
    expect(retries.map(({ attempt }) => attempt)).toEqual([1]);
    const stale = retries[0];
    client.disconnect();
    stale.callback();
    expect(stale.cancelled).toBe(true);
    expect(transports).toHaveLength(1);
    expect(fsm.context).toEqual({ attempt: 0 });
    client.stop();
  });

  it('retries with the next FSM attempt and resets the count on ready', () => {
    const retries = [];
    const retry = {
      schedule(attempt, callback) {
        const record = { attempt, callback };
        retries.push(record);
        return () => {};
      },
    };
    const { client, transports, fsm } = createClient({ retry });
    client.connect();
    transports[0].close();
    retries[0].callback();
    transports[1].close();
    expect(retries.map(({ attempt }) => attempt)).toEqual([1, 2]);
    retries[1].callback();
    transports[2].open();
    expect(fsm.context).toEqual({ attempt: 0 });
    expect(client.state).toBe('ready');
    client.stop();
  });

  it('calls the retry scheduler with its receiver', () => {
    const retry = {
      scheduled: false,
      schedule() {
        this.scheduled = true;
        return () => {};
      },
    };
    const { client, transports } = createClient({ retry });
    client.connect();
    transports[0].close();

    expect(retry.scheduled).toBe(true);
    client.stop();
  });

  it('returns to idle when retry scheduling fails and permits manual connect', () => {
    const cause = new Error('schedule failed');
    const retry = {
      schedule() {
        throw cause;
      },
    };
    const { client, transports } = createClient({ retry });
    const errors = [];
    client.onError((error) => errors.push(error));
    client.connect();
    transports[0].close({ clean: false });

    expect(client.state).toBe('idle');
    expect(errors).toEqual([cause, { clean: false }]);
    client.connect();
    expect(transports).toHaveLength(2);
    client.stop();
  });

  it('bounds connecting attempts and ignores a queued timeout after open', () => {
    const scheduler = createScheduler();
    const { client, transports } = createClient({
      scheduler,
      connectTimeoutMs: 10,
    });
    client.connect();
    const timeout = scheduler.tasks[0];
    transports[0].open();
    scheduler.fire(timeout);
    expect(timeout.cleared).toBe(true);
    expect(client.state).toBe('ready');
    expect(transports[0].disposed).toBe(false);
    client.stop();
  });

  it('retires a connection when its ready deadline expires', () => {
    const scheduler = createScheduler();
    const { client, transports } = createClient({
      scheduler,
      connectTimeoutMs: 10,
    });
    const errors = [];
    client.onError((error) => errors.push(error));
    client.connect();
    scheduler.fire(scheduler.tasks[0]);
    expect(client.state).toBe('idle');
    expect(transports[0].disposed).toBe(true);
    expect(errors[0].message).toBe('Connection timed out');
    client.stop();
  });

  it('disposes a transport returned after its factory reenters disconnect', () => {
    let client;
    const transport = new StubTransport();
    client = createClient({
      createTransport() {
        client.disconnect();
        return transport;
      },
    }).client;

    client.connect();

    expect(client.state).toBe('idle');
    expect(transport.disposed).toBe(true);
    client.stop();
  });

  it('ignores callbacks from a retired transport', () => {
    const { client, transports } = createClient();
    const messages = [];
    client.onMessage((message) => messages.push(message));
    client.connect();
    const old = transports[0];
    client.reconnect();
    old.open();
    old.receive('stale');
    old.fail(new Error('stale'));

    expect(client.state).toBe('connecting');
    expect(messages).toEqual([]);
    expect(old.disposed).toBe(true);
    client.stop();
  });

  it('ignores a late close callback after reconnect', () => {
    const { client, transports } = createClient();
    const states = [];
    client.subscribe((snapshot) => states.push(snapshot.value));
    client.connect();
    const old = transports[0];
    old.open();
    client.reconnect();
    old.close();

    expect(client.state).toBe('connecting');
    expect(transports).toHaveLength(2);
    expect(states).toEqual(['connecting', 'ready', 'connecting']);
    client.stop();
  });

  it('suppresses stale state publication after a nested disconnect', () => {
    const { client, transports } = createClient();
    const states = [];
    client.subscribe((snapshot) => {
      states.push(snapshot.value);
      if (snapshot.value === 'connecting') client.disconnect();
    });

    client.connect();

    expect(states).toEqual(['connecting', 'idle']);
    expect(transports).toHaveLength(0);
    client.stop();
  });

  it('suppresses an obsolete snapshot for later state listeners', () => {
    const { client } = createClient();
    const seen = [];
    client.subscribe((snapshot) => {
      seen.push(`first:${snapshot.value}`);
      if (snapshot.value === 'connecting') client.disconnect();
    });
    client.subscribe((snapshot) => seen.push(`second:${snapshot.value}`));

    client.connect();

    expect(seen).toEqual(['first:connecting', 'first:idle', 'second:idle']);
    client.stop();
  });

  it('reuses duplicate state subscriptions and releases them on stop', () => {
    const { client } = createClient();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    expect(client.subscribe(listener)).toBe(unsubscribe);
    const initialCalls = listener.mock.calls.length;
    client.connect();
    expect(listener).toHaveBeenCalledTimes(initialCalls + 1);
    client.stop();
    const stoppedCalls = listener.mock.calls.length;
    client.connect();
    expect(listener).toHaveBeenCalledTimes(stoppedCalls);
  });

  it('suppresses ready when monitor startup fails synchronously', () => {
    const cause = new Error('monitor failed');
    const { client, transports } = createClient({
      createKeepalive: () => ({
        onFail: (listener) => {
          listener(cause);
          return () => {};
        },
        start() {},
        probeNow() {},
        activity() {},
        stop() {},
      }),
    });
    const ready = vi.fn();
    const errors = [];
    client.onReady(ready);
    client.onError((error) => errors.push(error));
    client.connect();
    transports[0].open();

    expect(client.state).toBe('idle');
    expect(ready).not.toHaveBeenCalled();
    expect(errors).toEqual([cause]);
    expect(transports[0].disposed).toBe(true);
    client.stop();
  });

  it('retires the connection when the monitor factory throws', () => {
    const cause = new Error('monitor factory failed');
    const { client, transports } = createClient({
      createKeepalive() {
        throw cause;
      },
    });
    const errors = [];
    const readies = [];
    client.onError((error) => errors.push(error));
    client.onReady((info) => readies.push(info));
    client.connect();
    transports[0].open();

    expect(client.state).toBe('idle');
    expect(transports[0].disposed).toBe(true);
    expect(errors).toEqual([cause]);
    expect(readies).toEqual([]);
    client.stop();
  });

  it('continues releasing message subscriptions when one cleanup throws', () => {
    const cleanupError = new Error('publisher unsubscribe failed');
    const cleanupErrors = [];
    const diagnosticLogger = {
      debug() {},
      error() {},
      warn(message, metadata) {
        if (message === 'RealtimeClient message unsubscribe failed')
          cleanupErrors.push(metadata.cause);
      },
    };
    const publisher = new Emitter({ logger: diagnosticLogger });
    const messageSubscriptions = new Set();
    let messageRegistrations = 0;
    let releases = 0;
    const events = {
      on(type, listener) {
        const unsubscribe = publisher.on(type, listener);
        if (type !== 'message') return unsubscribe;
        messageRegistrations++;
        const registrationNumber = messageRegistrations;
        const release = () => {
          releases++;
          messageSubscriptions.delete(release);
          unsubscribe();
          if (registrationNumber === 1) throw cleanupError;
        };
        messageSubscriptions.add(release);
        return release;
      },
      emit(type, payload) {
        publisher.emit(type, payload);
      },
      stop() {
        publisher.stop();
      },
    };
    const { client, transports } = createClient({
      events,
      logger: diagnosticLogger,
      createKeepalive({ onMessage }) {
        onMessage(() => {});
        onMessage(() => {});
        throw new Error('monitor construction failed');
      },
    });

    expect(() => {
      client.connect();
      transports[0].open();
    }).not.toThrow();

    expect(transports).toHaveLength(1);
    expect(transports[0].disposed).toBe(true);
    expect(messageRegistrations).toBe(2);
    expect(releases).toBe(2);
    expect(messageSubscriptions.size).toBe(0);
    expect(cleanupErrors).toEqual([cleanupError]);
    client.stop();
  });

  it('releases a message subscription when registration reenters disconnect', () => {
    const publisher = new Emitter({ logger });
    const messageSubscriptions = new Set();
    let client;
    const events = {
      on(type, listener) {
        const unsubscribe = publisher.on(type, listener);
        if (type !== 'message') return unsubscribe;
        let active = true;
        const release = () => {
          if (!active) return;
          active = false;
          messageSubscriptions.delete(release);
          unsubscribe();
        };
        messageSubscriptions.add(release);
        client.disconnect();
        return release;
      },
      emit(type, payload) {
        publisher.emit(type, payload);
      },
      stop() {
        publisher.stop();
      },
    };
    const monitor = {
      onFail: () => () => {},
      start: vi.fn(),
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    const fixture = createClient({
      events,
      createKeepalive({ onMessage }) {
        onMessage(() => {});
        return monitor;
      },
    });
    client = fixture.client;

    client.connect();
    fixture.transports[0].open();

    expect(client.state).toBe('idle');
    expect(messageSubscriptions.size).toBe(0);
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(fixture.transports[0].disposed).toBe(true);
    client.stop();
  });

  it('releases an attempt message subscription when its owner unsubscribes', () => {
    const publisher = new Emitter({ logger });
    const messageSubscriptions = new Set();
    const events = {
      on(type, listener) {
        const unsubscribe = publisher.on(type, listener);
        if (type !== 'message') return unsubscribe;
        let active = true;
        const release = () => {
          if (!active) return;
          active = false;
          messageSubscriptions.delete(release);
          unsubscribe();
        };
        messageSubscriptions.add(release);
        return release;
      },
      emit(type, payload) {
        publisher.emit(type, payload);
      },
      stop() {
        publisher.stop();
      },
    };
    let unsubscribeMessage;
    const { client, transports } = createClient({
      events,
      createKeepalive({ onMessage }) {
        unsubscribeMessage = onMessage(() => {});
        return {
          onFail: () => () => {},
          start() {},
          probeNow() {},
          activity() {},
          stop() {},
        };
      },
    });

    client.connect();
    transports[0].open();
    expect(messageSubscriptions.size).toBe(1);
    unsubscribeMessage();
    unsubscribeMessage();
    expect(messageSubscriptions.size).toBe(0);
    client.stop();
  });

  it('stops a monitor returned after its factory reenters disconnect', () => {
    let client;
    const monitor = {
      onFail: () => () => {},
      start: vi.fn(),
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    const fixture = createClient({
      createKeepalive() {
        client.disconnect();
        return monitor;
      },
    });
    client = fixture.client;
    client.connect();
    fixture.transports[0].open();

    expect(client.state).toBe('idle');
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(monitor.start).not.toHaveBeenCalled();
    expect(fixture.transports[0].disposed).toBe(true);
    client.stop();
  });

  it('retires a connection when monitor.start throws', () => {
    const cause = new Error('monitor start failed');
    const monitor = {
      onFail: () => () => {},
      start() {
        throw cause;
      },
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    const fixture = createClient({ createKeepalive: () => monitor });
    const errors = [];
    const ready = vi.fn();
    fixture.client.onError((error) => errors.push(error));
    fixture.client.onReady(ready);
    fixture.client.connect();
    fixture.transports[0].open();

    expect(fixture.client.state).toBe('idle');
    expect(fixture.transports[0].disposed).toBe(true);
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(errors).toEqual([cause]);
    expect(ready).not.toHaveBeenCalled();
    fixture.client.stop();
  });

  it('retires a connection when monitor.start reenters disconnect', () => {
    let client;
    const monitor = {
      onFail: () => () => {},
      start() {
        client.disconnect();
      },
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    const fixture = createClient({ createKeepalive: () => monitor });
    client = fixture.client;
    const readies = [];
    client.onReady((info) => readies.push(info));
    client.connect();
    fixture.transports[0].open();

    expect(client.state).toBe('idle');
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(readies).toEqual([]);
    expect(fixture.transports[0].disposed).toBe(true);
    client.stop();
  });

  it('stops a monitor when monitor.start reenters stop', () => {
    let client;
    const monitor = {
      onFail: () => () => {},
      start() {
        client.stop();
      },
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    const fixture = createClient({ createKeepalive: () => monitor });
    client = fixture.client;
    const ready = vi.fn();
    client.onReady(ready);
    client.connect();
    fixture.transports[0].open();

    expect(client.state).toBe('stopped');
    expect(fixture.transports[0].disposed).toBe(true);
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  });

  it('unsubscribes a monitor whose onFail registration reenters disconnect', () => {
    let client;
    const unsubscribe = vi.fn();
    const monitor = {
      onFail() {
        client.disconnect();
        return unsubscribe;
      },
      start: vi.fn(),
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    const fixture = createClient({ createKeepalive: () => monitor });
    client = fixture.client;
    client.connect();
    fixture.transports[0].open();

    expect(client.state).toBe('idle');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(monitor.start).not.toHaveBeenCalled();
    client.stop();
  });

  it('cleans every owned resource when stop cleanup throws', () => {
    const warnings = [];
    const transport = new StubTransport();
    transport.onDispose = () => {
      throw new Error('dispose failed');
    };
    const monitorEvents = [];
    const { client } = createClient({
      logger: { ...logger, warn: (...args) => warnings.push(args) },
      createTransport: () => transport,
      createKeepalive: () => ({
        onFail: () => () => monitorEvents.push('unsubscribe'),
        start() {},
        probeNow() {},
        activity() {},
        stop() {
          monitorEvents.push('stop');
          throw new Error('stop failed');
        },
      }),
    });
    const states = [];
    client.subscribe((snapshot) => states.push(snapshot.value));
    client.connect();
    transport.open();
    expect(() => client.stop()).not.toThrow();

    expect(client.state).toBe('stopped');
    expect(states).toEqual(['connecting', 'ready', 'stopped']);
    expect(monitorEvents).toEqual(['unsubscribe', 'stop']);
    expect(transport.disposed).toBe(true);
    expect(warnings).toHaveLength(2);
  });

  it('continues cleanup when the FSM rejects STOP', () => {
    const base = createClient();
    const transport = new StubTransport();
    const warnings = [];
    const monitor = {
      onFail: () => () => {},
      start() {},
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    let subscriptions = 0;
    const fsm = {
      get state() {
        return base.fsm.state;
      },
      get snapshot() {
        return base.fsm.snapshot;
      },
      subscribe(listener) {
        const unsubscribe = base.fsm.subscribe(listener);
        return () => {
          subscriptions++;
          unsubscribe();
        };
      },
      send(event) {
        if (event.type === 'STOP') throw new Error('STOP rejected');
        base.fsm.send(event);
      },
    };
    const events = {
      on: (...args) => base.events.on(...args),
      emit: (...args) => base.events.emit(...args),
      stop: vi.fn(() => base.events.stop()),
    };
    const client = new RealtimeClient({
      fsm,
      events,
      createTransport: () => transport,
      retry: null,
      createKeepalive: () => monitor,
      logger: { ...logger, warn: (...args) => warnings.push(args) },
    });
    client.connect();
    transport.open();

    expect(() => client.stop()).not.toThrow();
    expect(client.state).toBe('ready');
    expect(transport.disposed).toBe(true);
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(subscriptions).toBe(1);
    expect(events.stop).toHaveBeenCalledOnce();
    expect(warnings.some(([message]) => message.includes('fsm stop'))).toBe(
      true,
    );
  });

  it('continues cleanup when stopped-state publication throws', () => {
    const base = createClient();
    const transport = new StubTransport();
    const warnings = [];
    const monitor = {
      onFail: () => () => {},
      start() {},
      probeNow() {},
      activity() {},
      stop: vi.fn(),
    };
    let subscriptions = 0;
    const fsm = {
      get state() {
        return base.fsm.state;
      },
      get snapshot() {
        return base.fsm.snapshot;
      },
      subscribe(listener) {
        const unsubscribe = base.fsm.subscribe(listener);
        return () => {
          subscriptions++;
          unsubscribe();
        };
      },
      send: (...args) => base.fsm.send(...args),
    };
    const events = {
      on: (...args) => base.events.on(...args),
      emit(type, snapshot) {
        if (type === 'state' && snapshot.value === 'stopped')
          throw new Error('state publication failed');
        base.events.emit(type, snapshot);
      },
      stop: vi.fn(() => base.events.stop()),
    };
    const client = new RealtimeClient({
      fsm,
      events,
      createTransport: () => transport,
      retry: null,
      createKeepalive: () => monitor,
      logger: { ...logger, warn: (...args) => warnings.push(args) },
    });
    client.connect();
    transport.open();

    expect(() => client.stop()).not.toThrow();
    expect(client.state).toBe('stopped');
    expect(transport.disposed).toBe(true);
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(subscriptions).toBe(1);
    expect(events.stop).toHaveBeenCalledOnce();
    expect(warnings.some(([message]) => message.includes('state event'))).toBe(
      true,
    );
  });

  it('lets a newer reconnect win during old monitor cleanup', () => {
    let client;
    let monitorStops = 0;
    const transports = [];
    client = createClient({
      createTransport() {
        const transport = new StubTransport();
        transports.push(transport);
        return transport;
      },
      createKeepalive: () => ({
        onFail: () => () => {},
        start() {},
        probeNow() {},
        activity() {},
        stop() {
          monitorStops++;
          if (monitorStops === 1) client.reconnect();
        },
      }),
    });
    client = client.client;
    client.connect();
    transports[0].open();

    client.disconnect();

    expect(client.state).toBe('connecting');
    expect(transports).toHaveLength(2);
    expect(transports[0].disposed).toBe(true);
    expect(transports[1].disposed).toBe(false);
    client.stop();
  });

  it('releases the event publisher if FSM subscription fails', () => {
    const cause = new Error('subscribe failed');
    const events = {
      on() {},
      emit() {},
      stop: vi.fn(),
    };
    const fsm = {
      state: 'idle',
      snapshot: { value: 'idle', context: { attempt: 0 }, version: 0 },
      send() {},
      subscribe() {
        throw cause;
      },
    };

    expect(
      () =>
        new RealtimeClient({
          fsm,
          events,
          createTransport: () => new StubTransport(),
        }),
    ).toThrow(cause);
    expect(events.stop).toHaveBeenCalledOnce();
  });

  it('keeps a terminal stopped snapshot and releases all resources', () => {
    const { client, transports } = createClient();
    const states = [];
    client.subscribe((snapshot) => states.push(snapshot.value));
    client.connect();
    client.stop();
    client.connect();

    expect(client.state).toBe('stopped');
    expect(client.snapshot.context).toEqual({ attempt: 0 });
    expect(states).toEqual(['connecting', 'stopped']);
    expect(transports[0].disposed).toBe(true);
  });
});
