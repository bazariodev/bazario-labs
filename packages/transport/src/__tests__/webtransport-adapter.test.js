import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebTransportAdapter } from '../index.js';
import { settle, webTransportPlatform } from './stream-platforms.js';

const active = [];
afterEach(async () => {
  for (const transport of active.splice(0)) transport[Symbol.dispose]();
  vi.unstubAllGlobals();
  await settle();
});

function setup(options) {
  const test = webTransportPlatform(options);
  active.push(test.transport);
  return test;
}

describe('WebTransport adapter', () => {
  it('constructs the session lazily and forwards URL and native options', async () => {
    const test = setup();
    const connections = [];
    vi.stubGlobal(
      'WebTransport',
      class {
        constructor(url, options) {
          connections.push({ url, options });
          Object.assign(this, test.session);
        }
      },
    );
    let url = 'https://example.com/old';
    const options = { congestionControl: 'low-latency' };
    const transport = new WebTransportAdapter({
      url: () => url,
      sessionOptions: options,
    });
    active.push(transport);
    expect(connections).toEqual([]);
    url = 'https://example.com/new';
    transport.start(test.handlers);
    expect(connections).toEqual([{ url, options }]);
    expect(test.events).toEqual([]);
    test.open();
    await settle();
    expect(test.events).toEqual([['open']]);
  });

  it('waits for both session readiness and the bidirectional stream before opening', async () => {
    const test = setup();
    test.transport.start(test.handlers);
    await settle();
    expect(test.streamRequested).toBe(false);
    test.ready.resolve();
    await settle();
    expect(test.events).toEqual([]);
    expect(() => test.transport.send('early')).toThrow(
      'Transport is not open.',
    );
    test.open();
    await settle();
    expect(test.events).toEqual([['open']]);
  });

  it('reports stream creation failure and closes the session', async () => {
    const test = setup();
    const cause = new Error('stream unavailable');
    test.transport.start(test.handlers);
    test.ready.resolve();
    await settle();
    test.stream.reject(cause);
    await settle();
    expect(test.events).toEqual([
      ['error', cause],
      ['close', { clean: false }],
    ]);
    expect(test.closed).toBe(true);
  });

  it('does not reopen after closure during stream creation', async () => {
    const test = setup();
    test.transport.start(test.handlers);
    test.ready.resolve();
    await settle();
    test.transport.close();
    test.open();
    await settle();
    expect(test.events).toEqual([['close', { clean: true }]]);
    expect(test.closed).toBe(true);
  });

  it('preserves remote session close metadata and rejects later writes', async () => {
    const test = setup();
    test.transport.start(test.handlers);
    test.open();
    await settle();
    test.remoteClose({ closeCode: 42, reason: 'server shutdown' });
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['close', { code: 42, reason: 'server shutdown', clean: true }],
    ]);
    expect(test.source.canceled).toBe(true);
    expect(() => test.transport.send('late')).toThrow('Transport is not open.');
  });

  it('reports a send-stream reset even without a pending write', async () => {
    const test = setup();
    const cause = new Error('send stream reset');
    test.transport.start(test.handlers);
    test.open();
    await settle();
    test.failWriter(cause);
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['error', cause],
      ['close', { clean: false }],
    ]);
    expect(test.closed).toBe(true);
  });

  it.each([
    'URL resolution',
    'session construction',
  ])('propagates %s errors from start', async (source) => {
    const cause = new Error('cannot connect');
    function fail() {
      throw cause;
    }
    const test = setup(
      source === 'URL resolution' ? { url: fail } : { WebTransport: fail },
    );
    expect(() => test.transport.start(test.handlers)).toThrow(cause);
    test.transport.close();
    await settle();
    expect(test.events).toEqual([]);
    expect(() => test.transport.start(test.handlers)).toThrow(
      'only be started once',
    );
  });

  it('keeps the first terminal result when stream failure precedes session metadata', async () => {
    const test = setup();
    const cause = new Error('stream failed');
    test.transport.start(test.handlers);
    test.open();
    await settle();
    test.source.failRead(cause);
    await settle();
    test.remoteClose({ closeCode: 42, reason: 'server shutdown' });
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['error', cause],
      ['close', { clean: false }],
    ]);
  });
});
