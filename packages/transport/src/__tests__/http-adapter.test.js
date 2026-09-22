import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAdapter } from '../index.js';
import { deferred, httpPlatform, observe, settle } from './stream-platforms.js';

const active = [];
afterEach(async () => {
  for (const transport of active.splice(0)) transport[Symbol.dispose]();
  vi.unstubAllGlobals();
  await settle();
});

describe('HTTP adapter', () => {
  it('resolves the URL at start and passes headers and credentials to GET and POST', async () => {
    const platform = httpPlatform();
    vi.stubGlobal('fetch', platform.fetchRequest);
    let url = 'https://example.com/old';
    const transport = new HttpAdapter({
      url: () => url,
      headers: { Authorization: 'Bearer test-token' },
      credentials: 'include',
    });
    active.push(transport);
    expect(platform.requests).toEqual([]);
    url = 'https://example.com/new';
    transport.start(platform.handlers);
    expect(platform.events).toEqual([]);
    platform.open();
    await settle();
    transport.send('hello');
    await settle();
    expect(platform.requests.map(({ method }) => method)).toEqual([
      'GET',
      'POST',
    ]);
    for (const request of platform.requests) {
      expect(request.url).toBe(url);
      expect(request.headers.get('Authorization')).toBe('Bearer test-token');
      expect(request.headers.get('Accept')).toBe('application/octet-stream');
      expect(request.credentials).toBe('include');
      expect(request.cache).toBe('no-store');
    }
    expect(platform.requests[1].headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
    platform.completeWrite();
  });

  it.each([
    [
      'HTTP error',
      () => new Response('unavailable', { status: 503 }),
      'HTTP GET failed: 503.',
    ],
    [
      'missing body',
      () => new Response(null, { status: 204 }),
      'HTTP GET response has no stream.',
    ],
  ])('rejects a GET %s before opening', async (_case, response, message) => {
    const test = httpPlatform();
    active.push(test.transport);
    test.transport.start(test.handlers);
    test.response.resolve(response());
    await settle();
    expect(test.events).toEqual([
      ['error', new Error(message)],
      ['close', { clean: false }],
    ]);
    expect(test.closed).toBe(true);
  });

  it('fails the attempt on an unsuccessful POST without sending queued messages', async () => {
    const test = httpPlatform();
    active.push(test.transport);
    test.transport.start(test.handlers);
    test.open();
    await settle();
    test.transport.send('first');
    test.transport.send('second');
    await settle();
    test.writes.shift().resolve(new Response('unavailable', { status: 503 }));
    await settle();
    expect(test.events).toEqual([
      ['open'],
      ['error', new Error('HTTP POST failed: 503.')],
      ['close', { clean: false }],
    ]);
    expect(test.sent).toHaveLength(1);
    expect(test.closed).toBe(true);
  });

  it('propagates URL resolution failure from start', () => {
    const cause = new Error('URL unavailable');
    const { transport, handlers, events } = httpPlatform({
      url: () => {
        throw cause;
      },
    });
    active.push(transport);
    expect(() => transport.start(handlers)).toThrow(cause);
    expect(events).toEqual([]);
  });

  it('exchanges ordered frames with a real streaming HTTP server', async () => {
    const received = [];
    const requestErrors = [];
    let incomingResponse;
    const server = createServer((request, response) => {
      if (request.method === 'GET') {
        incomingResponse = response;
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.flushHeaders();
        return;
      }
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('error', (cause) => requestErrors.push(cause));
      request.on('end', () => {
        const frame = Buffer.concat(chunks);
        received.push(new Uint8Array(frame));
        incomingResponse.write(frame.subarray(0, 2));
        incomingResponse.write(frame.subarray(2));
        response.writeHead(204).end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const done = deferred();
    const { events, handlers } = observe();
    const transport = new HttpAdapter({
      url: `http://127.0.0.1:${server.address().port}/attempt-1`,
    });
    active.push(transport);
    try {
      transport.start({
        ...handlers,
        onOpen() {
          handlers.onOpen();
          transport.send('hello');
          transport.send(new Uint8Array([1, 2]));
        },
        onMessage(message) {
          handlers.onMessage(message);
          if (events.length === 3) done.resolve();
        },
        onError: done.reject,
      });
      await done.promise;
      transport.close();
      await settle();
      expect(events).toEqual([
        ['open'],
        ['message', 'hello'],
        ['message', new Uint8Array([1, 2])],
        ['close', { clean: true }],
      ]);
      expect(received).toEqual([
        new Uint8Array([0, 0, 0, 0, 5, 104, 101, 108, 108, 111]),
        new Uint8Array([1, 0, 0, 0, 2, 1, 2]),
      ]);
      expect(requestErrors).toEqual([]);
    } finally {
      transport[Symbol.dispose]();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
