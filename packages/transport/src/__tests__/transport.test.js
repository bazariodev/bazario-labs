import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketAdapter } from '../index.js';
import { settle } from './stream-platforms.js';
import { TestWebSocket } from './websocket.js';

function setup(options = {}) {
  const socket = new TestWebSocket();
  function WebSocket() {
    return socket;
  }
  const events = [];
  const handlers = {
    onOpen: () => events.push(['open']),
    onMessage: (message) => events.push(['message', message]),
    onError: (cause) => events.push(['error', cause]),
    onClose: (close) => events.push(['close', close]),
  };
  const transport = new WebSocketAdapter({
    url: 'wss://example.com',
    WebSocket,
    ...options,
  });
  return { transport, socket, handlers, events };
}

afterEach(() => vi.unstubAllGlobals());

describe('WebSocket transport', () => {
  it('resolves the URL and opens the platform socket only when started', () => {
    const connections = [];
    vi.stubGlobal(
      'WebSocket',
      class extends TestWebSocket {
        constructor(url, protocols) {
          super(url, protocols);
          connections.push(this);
        }
      },
    );
    let url = 'wss://example.com/old';
    const { handlers, events } = setup();
    const transport = new WebSocketAdapter({
      url: () => url,
      protocols: ['bazario.realtime.v1'],
    });

    expect(connections).toEqual([]);
    url = 'wss://example.com/current';
    transport.start(handlers);
    expect(connections).toHaveLength(1);
    expect(connections[0].url).toBe(url);
    expect(connections[0].protocols).toEqual(['bazario.realtime.v1']);
    connections[0].open();
    expect(events).toEqual([['open']]);
    transport[Symbol.dispose]();
  });

  it('delivers text and normalized binary messages in arrival order', () => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    socket.open();
    socket.receive('first');
    socket.receive(new Uint8Array([1, 2]));
    socket.receive('last');
    socket.finishClose({ code: 1000, reason: 'done', wasClean: true });

    expect(events).toEqual([
      ['open'],
      ['message', 'first'],
      ['message', new Uint8Array([1, 2])],
      ['message', 'last'],
      ['close', { code: 1000, reason: 'done', clean: true }],
    ]);
  });

  it('reports errors as diagnostics until a terminal close arrives', () => {
    const { transport, socket, handlers, events } = setup();
    const cause = new Error('network error');
    transport.start(handlers);
    socket.open();
    socket.fail(cause);
    socket.receive('still receiving');
    socket.finishClose({ code: 1006, wasClean: false });

    expect(events).toEqual([
      ['open'],
      ['error', cause],
      ['message', 'still receiving'],
      ['close', { code: 1006, reason: '', clean: false }],
    ]);
  });

  it('accepts outgoing text and byte views without changing their contents', () => {
    const { transport, socket, handlers } = setup();
    transport.start(handlers);
    socket.open();
    const bytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);

    expect(transport.send('hello')).toBeUndefined();
    expect(transport.send(bytes)).toBeUndefined();
    expect(socket.sent).toEqual(['hello', new Uint8Array([1, 2])]);
  });

  it('rejects writes outside the open state without replaying them', () => {
    const { transport, socket, handlers } = setup();
    expect(() => transport.send('before start')).toThrow(
      'Transport is not open.',
    );
    transport.start(handlers);
    expect(() => transport.send('connecting')).toThrow(
      'Transport is not open.',
    );
    socket.open();
    expect(socket.sent).toEqual([]);
    expect(transport.send('open')).toBeUndefined();
    transport.close();
    expect(() => transport.send('closing')).toThrow('Transport is not open.');
    socket.finishClose();
    expect(() => transport.send('closed')).toThrow('Transport is not open.');
    expect(socket.sent).toEqual(['open']);
  });

  it('checks projected UTF-8 bytes and admits a write exactly at the limit', () => {
    const { transport, socket, handlers } = setup({ maxBufferedBytes: 6 });
    transport.start(handlers);
    socket.open();
    socket.bufferedAmount = 3;
    expect(() => transport.send('😀')).toThrow(
      'Transport buffer limit exceeded.',
    );
    socket.bufferedAmount = 2;
    expect(transport.send('😀')).toBeUndefined();
    expect(socket.sent).toEqual(['😀']);
  });

  it('counts the bytes in a view instead of its entire backing buffer', () => {
    const { transport, socket, handlers } = setup({ maxBufferedBytes: 4 });
    transport.start(handlers);
    socket.open();
    socket.bufferedAmount = 2;
    expect(
      transport.send(new Uint8Array([0, 1, 2, 3]).subarray(1, 3)),
    ).toBeUndefined();
    expect(() => transport.send(new Uint8Array([1, 2, 3]))).toThrow(
      'Transport buffer limit exceeded.',
    );
    expect(socket.sent).toEqual([new Uint8Array([1, 2])]);
  });

  it('defaults to a 1 MiB local write limit', () => {
    const { transport, socket, handlers } = setup();
    transport.start(handlers);
    socket.open();
    socket.bufferedAmount = 1024 * 1024;
    expect(() => transport.send('a')).toThrow(
      'Transport buffer limit exceeded.',
    );
    socket.bufferedAmount -= 1;
    expect(transport.send('a')).toBeUndefined();
  });

  it('propagates the original platform send error without retaining the message', () => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    socket.open();
    const cause = new Error('write failed');
    socket.sendError = cause;
    let thrown;
    try {
      transport.send('failed');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(cause);
    expect(events).toEqual([['open']]);
    socket.sendError = null;
    expect(transport.send('next')).toBeUndefined();
    expect(socket.sent).toEqual(['next']);
  });

  it.each([
    'connecting',
    'open',
  ])('closes a %s attempt idempotently', (state) => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    if (state === 'open') socket.open();
    events.length = 0;
    transport.close();
    transport.close();
    expect(socket.readyState).toBe(2);
    expect(events).toEqual([]);
    socket.finishClose();
    transport.close();
    expect(events).toEqual([
      ['close', { code: 1000, reason: '', clean: true }],
    ]);
  });

  it('does not notify after the terminal close', () => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    socket.finishClose();
    socket.open();
    socket.receive('late');
    socket.fail(new Error('late'));
    socket.finishClose();

    expect(events).toEqual([
      ['close', { code: 1000, reason: '', clean: true }],
    ]);
    expect(() => transport.send('late')).toThrow('Transport is not open.');
    expect(() => transport.start(handlers)).toThrow('only be started once');
  });

  it.each([
    'connecting',
    'open',
  ])('disposes a %s attempt without further notifications', (state) => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    if (state === 'open') socket.open();
    events.length = 0;
    transport[Symbol.dispose]();
    transport[Symbol.dispose]();
    expect(socket.readyState).toBe(2);
    socket.open();
    socket.receive('late');
    socket.fail(new Error('late'));
    socket.finishClose();

    expect(events).toEqual([]);
    expect(() => transport.send('late')).toThrow('Transport is not open.');
    expect(() => transport.start(handlers)).toThrow('only be started once');
  });

  it('cannot open a disposed or already-started transport', () => {
    const { transport, handlers } = setup();
    transport[Symbol.dispose]();
    expect(() => transport.start(handlers)).toThrow('only be started once');

    const active = setup();
    active.transport.start(active.handlers);
    expect(() => active.transport.start(active.handlers)).toThrow(
      'only be started once',
    );
    active.transport[Symbol.dispose]();
  });

  it.each([
    'URL resolution',
    'WebSocket construction',
  ])('propagates %s failure from start', async (source) => {
    const cause = new Error('cannot connect');
    function fail() {
      throw cause;
    }
    const { transport, handlers, events } = setup(
      source === 'URL resolution' ? { url: fail } : { WebSocket: fail },
    );

    expect(() => transport.start(handlers)).toThrow(cause);
    expect(() => transport.send('hello')).toThrow('Transport is not open.');
    transport.close();
    await settle();
    expect(events).toEqual([]);
    expect(() => transport.start(handlers)).toThrow('only be started once');
  });

  it('reports unsupported incoming data and closes the attempt', () => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    socket.open();
    socket.receive(new Blob(['unsupported']));
    expect(socket.readyState).toBe(2);
    socket.finishClose();

    expect(events).toEqual([
      ['open'],
      ['error', expect.any(TypeError)],
      ['close', { code: 1000, reason: '', clean: true }],
    ]);
  });

  it('preserves an unclean platform close after local cancellation while connecting', () => {
    const { transport, socket, handlers, events } = setup();
    transport.start(handlers);
    transport.close();
    socket.finishClose({ code: 1006, wasClean: false });
    expect(events).toEqual([
      ['close', { code: 1006, reason: '', clean: false }],
    ]);
  });
});
