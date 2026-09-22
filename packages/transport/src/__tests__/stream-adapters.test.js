import { afterEach, describe, expect, it } from 'vitest';
import {
  httpPlatform,
  settle,
  webTransportPlatform,
} from './stream-platforms.js';

const platforms = [
  ['HTTP', httpPlatform],
  ['WebTransport', webTransportPlatform],
];

describe.each(platforms)('%s public transport behavior', (_name, create) => {
  const active = [];
  function setup(options) {
    const test = create(options);
    active.push(test.transport);
    return test;
  }
  async function connected(options) {
    const test = setup(options);
    test.transport.start(test.handlers);
    test.open();
    await settle();
    return test;
  }
  afterEach(async () => {
    for (const transport of active.splice(0)) transport[Symbol.dispose]();
    await settle();
  });

  it('preserves message boundaries, UTF-8 text, byte views, and arrival order', async () => {
    const { source, events } = await connected();
    // Text "é", binary [1, 2], empty text, empty binary, and a literal text BOM.
    source.receive([0, 0]);
    source.receive([0, 0, 2, 0xc3]);
    source.receive([
      0xa9, 1, 0, 0, 0, 2, 1, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3,
      0xef, 0xbb, 0xbf,
    ]);
    source.end();
    await settle();
    expect(events).toEqual([
      ['open'],
      ['message', 'é'],
      ['message', new Uint8Array([1, 2])],
      ['message', ''],
      ['message', new Uint8Array(0)],
      ['message', '\uFEFF'],
      ['close', { clean: true }],
    ]);
  });

  it('writes framed messages in order and snapshots mutable byte views', async () => {
    const test = await connected();
    const { transport, sent } = test;
    const bytes = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
    expect(transport.send('é')).toBeUndefined();
    expect(transport.send(bytes)).toBeUndefined();
    bytes.fill(0);
    await settle();
    expect(sent).toEqual([new Uint8Array([0, 0, 0, 0, 2, 0xc3, 0xa9])]);
    test.completeWrite();
    await settle();
    expect(sent).toEqual([
      new Uint8Array([0, 0, 0, 0, 2, 0xc3, 0xa9]),
      new Uint8Array([1, 0, 0, 0, 2, 1, 2]),
    ]);
    test.completeWrite();
  });

  it('rejects writes before open and after close without replaying them', async () => {
    const test = setup();
    const { transport, handlers, events } = test;
    expect(() => transport.send('before start')).toThrow(
      'Transport is not open.',
    );
    transport.start(handlers);
    expect(() => transport.send('connecting')).toThrow(
      'Transport is not open.',
    );
    test.open();
    await settle();
    expect(test.sent).toEqual([]);
    transport.close();
    transport.close();
    expect(() => transport.send('closed')).toThrow('Transport is not open.');
    expect(() => transport.start(handlers)).toThrow('only be started once');
    await settle();
    expect(events).toEqual([['open'], ['close', { clean: true }]]);
    expect(test.closed).toBe(true);
  });

  it('bounds outstanding frame bytes and permits new writes after completion', async () => {
    const test = await connected({ maxBufferedBytes: 7 });
    expect(test.transport.send('é')).toBeUndefined();
    expect(() => test.transport.send('')).toThrow(
      'Transport buffer limit exceeded.',
    );
    await settle();
    test.completeWrite();
    await settle();
    expect(test.transport.send(new Uint8Array([1, 2]))).toBeUndefined();
    await settle();
    expect(test.sent).toHaveLength(2);
    test.completeWrite();
  });

  it('rejects oversized outgoing payloads without failing the connection', async () => {
    const { transport, events, sent } = await connected({ maxMessageBytes: 1 });
    expect(() => transport.send('é')).toThrow(
      'Transport message limit exceeded.',
    );
    expect(() => transport.send(new Uint8Array([1, 2]))).toThrow(
      'Transport message limit exceeded.',
    );
    expect(events).toEqual([['open']]);
    expect(sent).toEqual([]);
    expect(transport.send('a')).toBeUndefined();
  });

  it('reports an async write failure once, then drops remaining writes', async () => {
    const test = await connected();
    const cause = new Error('write failed');
    test.transport.send('first');
    test.transport.send('second');
    await settle();
    test.failWrite(cause);
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['error', cause],
      ['close', { clean: false }],
    ]);
    expect(test.sent).toHaveLength(1);
    expect(test.closed).toBe(true);
    expect(() => test.transport.send('third')).toThrow(
      'Transport is not open.',
    );
  });

  it.each([
    'opening',
    'open',
  ])('closes while %s and suppresses late completion', async (state) => {
    const test = setup();
    test.transport.start(test.handlers);
    if (state === 'open') {
      test.open();
      await settle();
    }
    test.events.length = 0;
    test.transport.close();
    test.transport.close();
    if (state === 'opening') test.open();
    await settle();
    expect(test.closed).toBe(true);
    expect(test.events).toEqual([['close', { clean: true }]]);
  });

  it.each([
    'opening',
    'open',
  ])('disposes while %s without notifying', async (state) => {
    const test = setup();
    test.transport.start(test.handlers);
    if (state === 'open') {
      test.open();
      await settle();
      test.transport.send('pending');
      test.transport.send('buffered');
      await settle();
    }
    test.events.length = 0;
    test.transport[Symbol.dispose]();
    test.transport[Symbol.dispose]();
    if (state === 'opening') test.open();
    await settle();
    expect(test.closed).toBe(true);
    expect(test.events).toEqual([]);
    expect(() => test.transport.send('late')).toThrow('Transport is not open.');
    expect(() => test.transport.start(test.handlers)).toThrow(
      'only be started once',
    );
    expect(test.sent.length).toBe(state === 'open' ? 1 : 0);
  });

  it('cannot start a disposed instance or start twice', () => {
    const disposed = setup();
    disposed.transport[Symbol.dispose]();
    expect(() => disposed.transport.start(disposed.handlers)).toThrow(
      'only be started once',
    );
    const active = setup();
    active.transport.start(active.handlers);
    expect(() => active.transport.start(active.handlers)).toThrow(
      'only be started once',
    );
  });

  it('reports a failed connection without opening', async () => {
    const test = setup();
    const cause = new Error('connection failed');
    test.transport.start(test.handlers);
    test.failOpen(cause);
    await settle();
    expect(test.events).toEqual([
      ['error', cause],
      ['close', { clean: false }],
    ]);
    expect(test.closed).toBe(true);
  });

  it('reports read failures and closes the resource', async () => {
    const test = await connected();
    const cause = new Error('read failed');
    test.source.failRead(cause);
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['error', cause],
      ['close', { clean: false }],
    ]);
    expect(test.closed).toBe(true);
  });

  it.each([
    ['unknown type', [2, 0, 0, 0, 0]],
    ['oversized payload', [0, 0, 0, 0, 3]],
    ['invalid UTF-8', [0, 0, 0, 0, 1, 0xff]],
    ['truncated payload', [0, 0, 0, 0, 2, 0x61]],
    ['truncated header', [0, 0]],
  ])('closes on %s', async (_case, frame) => {
    const test = await connected({ maxMessageBytes: 2 });
    test.source.receive(frame);
    test.source.end();
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['error', expect.any(Error)],
      ['close', { clean: false }],
    ]);
    expect(test.closed).toBe(true);
  });

  it.each([
    'onOpen',
    'onMessage',
  ])('allows disposal from %s', async (callback) => {
    const test = setup();
    const handler = test.handlers[callback];
    test.handlers[callback] = (...args) => {
      handler(...args);
      test.transport[Symbol.dispose]();
    };
    test.transport.start(test.handlers);
    test.open();
    await settle();
    if (callback === 'onMessage')
      test.source.receive([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await settle();
    expect(test.events).toEqual(
      callback === 'onOpen' ? [['open']] : [['open'], ['message', '']],
    );
    expect(test.closed).toBe(true);
  });
});
