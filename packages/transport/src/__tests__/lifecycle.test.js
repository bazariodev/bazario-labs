import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketAdapter } from '../index.js';
import {
  httpPlatform,
  observe,
  settle,
  webTransportPlatform,
} from './stream-platforms.js';
import { TestWebSocket } from './websocket.js';

function websocketPlatform(options = {}) {
  const socket = new TestWebSocket();
  function WebSocket() {
    return socket;
  }
  return {
    ...observe(),
    transport: new WebSocketAdapter({
      url: 'wss://example.com',
      WebSocket,
      ...options,
    }),
    open: () => socket.open(),
    failOpen: (cause) => socket.fail(cause),
    finishClose: () => queueMicrotask(() => socket.finishClose()),
  };
}

function createLogger() {
  return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe.each([
  ['WebSocketAdapter', websocketPlatform],
  ['HttpAdapter', httpPlatform],
  ['WebTransportAdapter', webTransportPlatform],
])('%s lifecycle contract', (name, create) => {
  const active = [];
  function setup(options) {
    const test = create(options);
    active.push(test.transport);
    return test;
  }
  afterEach(async () => {
    for (const transport of active.splice(0)) transport[Symbol.dispose]();
    await settle();
  });

  it('makes close before start terminal without notifying', async () => {
    const { transport, handlers, events } = setup();
    transport.close();
    transport.close();
    expect(() => transport.start(handlers)).toThrow('only be started once');
    expect(() => transport.send('late')).toThrow('Transport is not open.');
    await settle();
    expect(events).toEqual([]);
  });

  it('makes a thrown start terminal and silent, including a later close', async () => {
    const cause = new Error('URL unavailable');
    const logger = createLogger();
    const { transport, handlers, events } = setup({
      logger,
      url() {
        throw cause;
      },
    });
    let thrown;
    try {
      transport.start(handlers);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(cause);
    transport.close();
    await settle();
    expect(events).toEqual([]);
    expect(() => transport.start(handlers)).toThrow('only be started once');
    expect(() => transport.send('late')).toThrow('Transport is not open.');
    expect(logger.debug.mock.calls).toEqual([[`${name} starting.`]]);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      `${name} failed to start.`,
      cause,
    );
  });

  it('logs lifecycle and close metadata without logging message traffic', async () => {
    const logger = createLogger();
    const test = setup({ logger });
    expect(logger.debug).not.toHaveBeenCalled();
    test.transport.start(test.handlers);
    test.open();
    await settle();
    test.transport.send('message payload');
    await settle();
    expect(logger.debug.mock.calls).toEqual([
      [`${name} starting.`],
      [`${name} opened.`],
    ]);

    test.transport.close();
    test.transport.close();
    test.finishClose?.();
    await settle();
    const close = test.events.find(([event]) => event === 'close')[1];
    expect(logger.debug.mock.calls).toEqual([
      [`${name} starting.`],
      [`${name} opened.`],
      [`${name} closed.`, close],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a connection diagnostic with the original cause and still notifies', async () => {
    const logger = createLogger();
    const cause = new Error('Connection failed');
    const test = setup({ logger });
    test.transport.start(test.handlers);
    test.failOpen(cause);
    await settle();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      `${name} error.`,
      cause,
    );
    expect(test.events).toContainEqual(['error', cause]);
  });

  it.each([
    'connecting',
    'open',
  ])('never calls back synchronously from close while %s', async (state) => {
    const test = setup();
    test.transport.start(test.handlers);
    if (state === 'open') {
      test.open();
      await settle();
    }
    test.events.length = 0;
    test.transport.close();
    test.transport.close();
    expect(test.events).toEqual([]);
    expect(() => test.transport.send('closing')).toThrow(
      'Transport is not open.',
    );
    test.finishClose?.();
    await settle();
    expect(test.events).toEqual([
      ['close', expect.objectContaining({ clean: true })],
    ]);
  });

  it('lets disposal suppress a pending close notification', async () => {
    const logger = createLogger();
    const test = setup({ logger });
    test.transport.start(test.handlers);
    test.open();
    await settle();
    test.events.length = 0;
    test.transport.close();
    test.finishClose?.();
    test.transport[Symbol.dispose]();
    await settle();
    expect(test.events).toEqual([]);
    expect(logger.debug.mock.calls).toEqual([
      [`${name} starting.`],
      [`${name} opened.`],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
