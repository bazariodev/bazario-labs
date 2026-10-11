import { DEFAULT_LIMIT_BYTES } from './limits.js';
import { NOOP_LOGGER } from './logger.js';

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const encoder = new TextEncoder();
const ignoreError = () => {};

export class WebSocketAdapter {
  #options;
  #logger;
  #socket = null;
  #handlers = null;
  #stopped = false;

  constructor({
    url,
    protocols,
    maxBufferedBytes = DEFAULT_LIMIT_BYTES,
    WebSocket = globalThis.WebSocket,
    logger = NOOP_LOGGER,
  }) {
    this.#logger = logger;
    this.#options = { url, protocols, maxBufferedBytes, WebSocket };
  }

  start(handlers) {
    if (this.#handlers || this.#stopped) {
      throw new Error('A transport can only be started once.');
    }

    this.#handlers = handlers;
    this.#logger.debug('WebSocketAdapter starting.');
    if (!this.#isCurrent(handlers)) return;

    const { url, protocols, WebSocket } = this.#options;
    let resolvedUrl;
    let socket;
    try {
      resolvedUrl = typeof url === 'function' ? url() : url;
      if (!this.#isCurrent(handlers)) return;
      socket = new WebSocket(resolvedUrl, protocols);
    } catch (cause) {
      if (this.#isCurrent(handlers)) this.#detach();
      this.#logger.error('WebSocketAdapter failed to start.', cause);
      throw cause;
    }

    if (!this.#isCurrent(handlers)) {
      this.#detachSocket(socket);
      try {
        socket.close();
      } catch (cause) {
        try {
          this.#logger.error(
            'WebSocketAdapter could not close a retired socket.',
            cause,
          );
        } catch {}
      }
      return;
    }

    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    if (!this.#isCurrent(handlers, socket)) return;

    socket.onopen = () => {
      if (!this.#isCurrent(handlers, socket)) return;
      this.#logger.debug('WebSocketAdapter opened.');
      if (!this.#isCurrent(handlers, socket)) return;
      handlers.onOpen();
    };
    socket.onerror = (cause) => this.#error(cause, handlers, socket);
    socket.onmessage = (event) => {
      if (!this.#isCurrent(handlers, socket)) return;
      const { data } = event;
      if (typeof data === 'string') {
        if (this.#isCurrent(handlers, socket)) handlers.onMessage(data);
      } else if (data instanceof ArrayBuffer) {
        if (this.#isCurrent(handlers, socket))
          handlers.onMessage(new Uint8Array(data));
      } else {
        try {
          this.#error(
            new TypeError('Expected text or ArrayBuffer data.'),
            handlers,
            socket,
          );
        } finally {
          if (this.#isCurrent(handlers, socket)) this.close();
        }
      }
    };
    socket.onclose = ({ code, reason, wasClean }) => {
      if (!this.#isCurrent(handlers, socket)) return;
      this.#detach();
      const close = { code, reason, clean: wasClean };
      this.#logger.debug('WebSocketAdapter closed.', close);
      handlers.onClose(close);
    };
  }

  send(message) {
    const socket = this.#socket;
    if (!socket || socket.readyState !== OPEN) {
      throw new Error('Transport is not open.');
    }

    const bytes =
      typeof message === 'string'
        ? encoder.encode(message).byteLength
        : message.byteLength;
    if (socket.bufferedAmount + bytes > this.#options.maxBufferedBytes) {
      throw new Error('Transport buffer limit exceeded.');
    }

    socket.send(message);
  }

  close() {
    if (this.#socket) this.#socket.close();
    else this.#detach();
  }

  [Symbol.dispose]() {
    const socket = this.#socket;
    this.#detach();
    socket?.close();
  }

  #error(cause, handlers, socket) {
    if (!this.#isCurrent(handlers, socket)) return;
    const isTerminal =
      socket.readyState === CLOSING || socket.readyState === CLOSED;
    this.#logger.error('WebSocketAdapter error.', cause);
    if (!this.#isCurrent(handlers, socket)) return;
    handlers.onError(cause);
    if (!isTerminal || !this.#isCurrent(handlers, socket)) return;
    this.#detach();
    handlers.onClose({ clean: false });
  }

  #isCurrent(handlers, socket) {
    return (
      !this.#stopped &&
      this.#handlers === handlers &&
      (socket === undefined || this.#socket === socket)
    );
  }

  #detach() {
    this.#stopped = true;
    this.#handlers = null;
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return;

    this.#detachSocket(socket);
  }

  #detachSocket(socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = ignoreError;
    socket.onclose = null;
  }
}
