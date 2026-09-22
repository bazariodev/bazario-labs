import { encodeMessage, readMessages } from './framing.js';
import { DEFAULT_LIMIT_BYTES } from './limits.js';
import { NOOP_LOGGER } from './logger.js';

export class HttpAdapter {
  #options;
  #logger;
  #url;
  #abort = null;
  #reader = null;
  #handlers = null;
  #stopped = false;
  #bufferedBytes = 0;
  #pending = Promise.resolve();

  constructor({
    url,
    headers,
    credentials,
    maxMessageBytes = DEFAULT_LIMIT_BYTES,
    maxBufferedBytes = DEFAULT_LIMIT_BYTES,
    fetch = globalThis.fetch,
    logger = NOOP_LOGGER,
  }) {
    this.#logger = logger;
    this.#options = {
      url,
      headers,
      credentials,
      maxMessageBytes,
      maxBufferedBytes,
      fetch,
    };
  }

  start(handlers) {
    if (this.#handlers || this.#stopped) {
      throw new Error('A transport can only be started once.');
    }
    this.#handlers = handlers;
    this.#logger.debug('HttpAdapter starting.');
    const { url } = this.#options;
    try {
      this.#url = typeof url === 'function' ? url() : url;
      this.#abort = new AbortController();
    } catch (cause) {
      this[Symbol.dispose]();
      this.#logger.error('HttpAdapter failed to start.', cause);
      throw cause;
    }
    this.#receive().catch((cause) => this.#fail(cause));
  }

  send(message) {
    if (!this.#reader || this.#stopped) {
      throw new Error('Transport is not open.');
    }
    const { maxMessageBytes, maxBufferedBytes } = this.#options;
    const frame = encodeMessage(message, maxMessageBytes);
    if (this.#bufferedBytes + frame.byteLength > maxBufferedBytes) {
      throw new Error('Transport buffer limit exceeded.');
    }

    this.#bufferedBytes += frame.byteLength;
    this.#pending = this.#pending
      .then(async () => {
        if (this.#stopped) return;
        const response = await this.#request('POST', frame);
        await response.body?.cancel();
        if (!response.ok)
          throw new Error(`HTTP POST failed: ${response.status}.`);
      })
      .then(
        () => {
          this.#bufferedBytes -= frame.byteLength;
        },
        (cause) => {
          this.#bufferedBytes -= frame.byteLength;
          this.#fail(cause);
        },
      );
  }

  close() {
    this.#finish({ clean: true });
  }

  [Symbol.dispose]() {
    this.#handlers = null;
    this.#stop();
  }

  #stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abort?.abort();
    this.#reader?.cancel().catch(() => {});
    this.#reader = null;
  }

  #request(method, body) {
    const { headers, credentials, fetch } = this.#options;
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', 'application/octet-stream');
    if (body) requestHeaders.set('Content-Type', 'application/octet-stream');
    return fetch(this.#url, {
      method,
      headers: requestHeaders,
      credentials,
      cache: 'no-store',
      signal: this.#abort.signal,
      body,
    });
  }

  async #receive() {
    const response = await this.#request('GET');
    if (this.#stopped) return response.body?.cancel();
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP GET failed: ${response.status}.`);
    }
    if (!response.body) throw new Error('HTTP GET response has no stream.');

    const reader = response.body.getReader();
    this.#reader = reader;
    this.#logger.debug('HttpAdapter opened.');
    this.#handlers.onOpen();
    for await (const message of readMessages(
      reader,
      this.#options.maxMessageBytes,
    )) {
      if (this.#stopped) return;
      this.#handlers.onMessage(message);
    }
    this.close();
  }

  #finish(close) {
    if (this.#stopped) return;
    this.#stop();
    queueMicrotask(() => {
      const handlers = this.#handlers;
      this.#handlers = null;
      if (handlers) {
        this.#logger.debug('HttpAdapter closed.', close);
        handlers.onClose(close);
      }
    });
  }

  #fail(cause) {
    if (this.#stopped) return;
    try {
      this.#logger.error('HttpAdapter error.', cause);
      this.#handlers.onError(cause);
    } finally {
      this.#finish({ clean: false });
    }
  }
}
