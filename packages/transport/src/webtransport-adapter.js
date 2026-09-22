import { encodeMessage, readMessages } from './framing.js';
import { DEFAULT_LIMIT_BYTES } from './limits.js';
import { NOOP_LOGGER } from './logger.js';

export class WebTransportAdapter {
  #options;
  #logger;
  #session = null;
  #reader = null;
  #writer = null;
  #handlers = null;
  #stopped = false;
  #bufferedBytes = 0;

  constructor({
    url,
    sessionOptions,
    maxMessageBytes = DEFAULT_LIMIT_BYTES,
    maxBufferedBytes = DEFAULT_LIMIT_BYTES,
    WebTransport = globalThis.WebTransport,
    logger = NOOP_LOGGER,
  }) {
    this.#logger = logger;
    this.#options = {
      url,
      sessionOptions,
      maxMessageBytes,
      maxBufferedBytes,
      WebTransport,
    };
  }

  start(handlers) {
    if (this.#handlers || this.#stopped) {
      throw new Error('A transport can only be started once.');
    }
    this.#handlers = handlers;
    this.#logger.debug('WebTransportAdapter starting.');
    const { url, sessionOptions, WebTransport } = this.#options;
    try {
      this.#session = new WebTransport(
        typeof url === 'function' ? url() : url,
        sessionOptions,
      );
    } catch (cause) {
      this[Symbol.dispose]();
      this.#logger.error('WebTransportAdapter failed to start.', cause);
      throw cause;
    }
    const session = this.#session;
    session.closed.then(
      ({ closeCode, reason }) =>
        this.#finish({ code: closeCode, reason, clean: true }),
      (cause) => this.#fail(cause),
    );
    this.#receive(session).catch((cause) => this.#failStream(cause));
  }

  send(message) {
    if (!this.#writer || this.#stopped) {
      throw new Error('Transport is not open.');
    }
    const { maxMessageBytes, maxBufferedBytes } = this.#options;
    const frame = encodeMessage(message, maxMessageBytes);
    if (this.#bufferedBytes + frame.byteLength > maxBufferedBytes) {
      throw new Error('Transport buffer limit exceeded.');
    }

    const pending = this.#writer.write(frame);
    this.#bufferedBytes += frame.byteLength;
    pending.then(
      () => {
        this.#bufferedBytes -= frame.byteLength;
      },
      (cause) => {
        this.#bufferedBytes -= frame.byteLength;
        this.#failStream(cause);
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
    this.#reader?.cancel().catch(() => {});
    this.#writer?.abort().catch(() => {});
    this.#reader = null;
    this.#writer = null;
    this.#session?.close();
    this.#session = null;
  }

  async #receive(session) {
    await session.ready;
    if (this.#stopped) return;
    const stream = await session.createBidirectionalStream();
    if (this.#stopped) return;

    const reader = stream.readable.getReader();
    this.#reader = reader;
    this.#writer = stream.writable.getWriter();
    this.#writer.closed.catch((cause) => this.#failStream(cause));
    this.#logger.debug('WebTransportAdapter opened.');
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
        this.#logger.debug('WebTransportAdapter closed.', close);
        handlers.onClose(close);
      }
    });
  }

  #failStream(cause) {
    // Session closure also errors its streams; session.closed owns that result.
    if (cause?.source !== 'session') this.#fail(cause);
  }

  #fail(cause) {
    if (this.#stopped) return;
    try {
      this.#logger.error('WebTransportAdapter error.', cause);
      this.#handlers.onError(cause);
    } finally {
      this.#finish({ clean: false });
    }
  }
}
