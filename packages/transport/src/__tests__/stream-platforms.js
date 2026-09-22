import { setImmediate } from 'node:timers/promises';
import { HttpAdapter, WebTransportAdapter } from '../index.js';

export const settle = () => setImmediate();

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function observe() {
  const events = [];
  return {
    events,
    handlers: {
      onOpen: () => events.push(['open']),
      onMessage: (message) => events.push(['message', message]),
      onError: (cause) => events.push(['error', cause]),
      onClose: (close) => events.push(['close', close]),
    },
  };
}

function incoming() {
  let controller;
  let canceled = false;
  const readable = new ReadableStream({
    start(value) {
      controller = value;
    },
    cancel() {
      canceled = true;
    },
  });
  return {
    readable,
    receive: (bytes) => controller.enqueue(new Uint8Array(bytes)),
    end: () => controller.close(),
    failRead: (cause) => controller.error(cause),
    get canceled() {
      return canceled;
    },
  };
}

export function httpPlatform(options = {}) {
  const source = incoming();
  const response = deferred();
  const requests = [];
  const writes = [];
  const sent = [];
  const fetchRequest = (url, init) => {
    requests.push({ url, ...init });
    if (init.method === 'GET') return response.promise;
    sent.push(new Uint8Array(init.body));
    const write = deferred();
    writes.push(write);
    init.signal.addEventListener('abort', () =>
      write.reject(init.signal.reason),
    );
    return write.promise;
  };
  return {
    ...observe(),
    source,
    requests,
    sent,
    writes,
    response,
    fetchRequest,
    transport: new HttpAdapter({
      url: 'https://example.com/attempt',
      fetch: fetchRequest,
      ...options,
    }),
    open: () => response.resolve(new Response(source.readable)),
    failOpen: (cause) => response.reject(cause),
    completeWrite: () =>
      writes.shift().resolve(new Response(null, { status: 204 })),
    failWrite: (cause) => writes.shift().reject(cause),
    get closed() {
      return requests[0]?.signal.aborted;
    },
  };
}

export function webTransportPlatform(options = {}) {
  const source = incoming();
  const ready = deferred();
  const closed = deferred();
  const stream = deferred();
  const sent = [];
  const writes = [];
  let writeController;
  let sessionClosed = false;
  let streamRequested = false;
  const writable = new WritableStream({
    start(controller) {
      writeController = controller;
    },
    write(bytes) {
      sent.push(new Uint8Array(bytes));
      const write = deferred();
      writes.push(write);
      return write.promise;
    },
  });
  const session = {
    ready: ready.promise,
    closed: closed.promise,
    createBidirectionalStream() {
      streamRequested = true;
      return stream.promise;
    },
    close() {
      sessionClosed = true;
      for (const write of writes) write.reject(new Error('Session closed.'));
      closed.resolve({ closeCode: 0, reason: '' });
    },
  };
  function WebTransport() {
    return session;
  }
  return {
    ...observe(),
    source,
    sent,
    session,
    ready,
    stream,
    transport: new WebTransportAdapter({
      url: 'https://example.com/attempt',
      WebTransport,
      ...options,
    }),
    open() {
      ready.resolve();
      stream.resolve({ readable: source.readable, writable });
    },
    failOpen(cause) {
      ready.reject(cause);
      closed.reject(cause);
    },
    completeWrite: () => writes.shift().resolve(),
    failWrite: (cause) => writes.shift().reject(cause),
    failWriter: (cause) => writeController.error(cause),
    remoteClose: (info) => closed.resolve(info),
    get closed() {
      return sessionClosed;
    },
    get streamRequested() {
      return streamRequested;
    },
  };
}
