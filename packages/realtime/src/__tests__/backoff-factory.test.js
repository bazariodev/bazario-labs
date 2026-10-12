import { afterEach, expect, it, vi } from 'vitest';
import { createRealtimeClient } from '../index.js';
import { createScheduler, StubTransport } from './direct-client-helpers.js';

afterEach(() => vi.useRealTimers());

it('shares a custom scheduler across timeout, backoff, and Keepalive', () => {
  const scheduler = createScheduler();
  const transports = [];
  const random = vi.fn(() => 0.8);
  const probe = vi.fn(() => new Promise(() => {}));
  const client = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      transports.push(transport);
      return transport;
    },
    scheduler,
    connectTimeoutMs: 7,
    reconnect: {
      initialDelayMs: 100,
      maxDelayMs: 300,
      factor: 2,
      jitter: { minRatio: 0.2, maxRatio: 0.2 },
    },
    random,
    keepalive: { probe, idleMs: 5, deadlineMs: 9 },
  });

  client.connect();
  scheduler.fire(scheduler.tasks.find(({ delayMs }) => delayMs === 7));

  expect(client.state).toBe('backoff');
  const retry = scheduler.tasks.find(({ delayMs }) => delayMs === 20);
  expect(retry).toBeDefined();
  expect(random).not.toHaveBeenCalled();
  scheduler.fire(retry);
  transports[1].open();
  scheduler.fire(
    scheduler.tasks.find(({ delayMs, cleared }) => delayMs === 5 && !cleared),
  );

  expect(probe).toHaveBeenCalledOnce();
  client.stop();
  expect(scheduler.tasks.filter(({ cleared }) => !cleared)).toEqual([]);
});

it('uses the top-level random fallback when nested randomness is undefined', () => {
  const scheduler = createScheduler();
  const transport = new StubTransport();
  const random = vi.fn(() => 0.5);
  const client = createRealtimeClient({
    createTransport: () => transport,
    scheduler,
    reconnect: {
      initialDelayMs: 100,
      maxDelayMs: 300,
      jitter: { minRatio: 0.2, maxRatio: 0.6, random: undefined },
    },
    random,
  });

  client.connect();
  transport.close();

  expect(scheduler.tasks.find(({ delayMs }) => delayMs === 40)).toBeDefined();
  expect(random).toHaveBeenCalledOnce();
  client.stop();
});

it('uses the top-level random fallback when reconnect jitter is omitted', () => {
  const scheduler = createScheduler();
  const transport = new StubTransport();
  const random = vi.fn(() => 0.5);
  const client = createRealtimeClient({
    createTransport: () => transport,
    scheduler,
    reconnect: { initialDelayMs: 100, maxDelayMs: 300 },
    random,
  });

  client.connect();
  transport.close();

  expect(scheduler.tasks.find(({ delayMs }) => delayMs === 50)).toBeDefined();
  expect(random).toHaveBeenCalledOnce();
  client.stop();
});

it('prefers nested randomness over the top-level fallback', () => {
  const scheduler = createScheduler();
  const transport = new StubTransport();
  const random = vi.fn(() => 0.25);
  const nestedRandom = vi.fn(() => 0.75);
  const client = createRealtimeClient({
    createTransport: () => transport,
    scheduler,
    reconnect: {
      initialDelayMs: 100,
      maxDelayMs: 300,
      jitter: { minRatio: 0.2, maxRatio: 0.6, random: nestedRandom },
    },
    random,
  });

  client.connect();
  transport.close();

  expect(scheduler.tasks.find(({ delayMs }) => delayMs === 50)).toBeDefined();
  expect(nestedRandom).toHaveBeenCalledOnce();
  expect(random).not.toHaveBeenCalled();
  client.stop();
});

it('skips all random draws when reconnect jitter is disabled', () => {
  const scheduler = createScheduler();
  const transport = new StubTransport();
  const random = vi.fn(() => 0.5);
  const client = createRealtimeClient({
    createTransport: () => transport,
    scheduler,
    reconnect: { initialDelayMs: 100, maxDelayMs: 300, jitter: false },
    random,
  });

  client.connect();
  transport.close();

  expect(scheduler.tasks.find(({ delayMs }) => delayMs === 100)).toBeDefined();
  expect(random).not.toHaveBeenCalled();
  client.stop();
});

it('validates invalid jitter through the coordination default', () => {
  expect(() =>
    createRealtimeClient({
      createTransport: () => new StubTransport(),
      reconnect: { jitter: 'invalid' },
      random: () => 0.5,
    }),
  ).toThrow(TypeError);
});

it('does not validate reconnect settings when retry is supplied or omitted', () => {
  const customRetry = { schedule: () => () => {} };
  for (const retry of [customRetry, null]) {
    const client = createRealtimeClient({
      createTransport: () => new StubTransport(),
      retry,
      reconnect: { jitter: 'invalid' },
    });
    client.stop();
  }
});

it('default timers drive timeout, retry, and Keepalive', async () => {
  vi.useFakeTimers();
  const transports = [];
  const probe = vi.fn(() => new Promise(() => {}));
  const client = createRealtimeClient({
    createTransport() {
      const transport = new StubTransport();
      transports.push(transport);
      return transport;
    },
    connectTimeoutMs: 10,
    reconnect: { initialDelayMs: 20, maxDelayMs: 30, jitter: false },
    keepalive: { probe, idleMs: 5, deadlineMs: 9 },
  });

  client.connect();
  await vi.advanceTimersByTimeAsync(10);
  expect(client.state).toBe('backoff');
  await vi.advanceTimersByTimeAsync(20);
  expect(transports).toHaveLength(2);
  transports[1].open();
  await vi.advanceTimersByTimeAsync(5);

  expect(probe).toHaveBeenCalledOnce();
  client.stop();
});
