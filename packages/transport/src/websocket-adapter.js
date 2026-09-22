import { DEFAULT_LIMIT_BYTES } from './limits.js';
import { NOOP_LOGGER } from './logger.js';

const OPEN = 1;
const encoder = new TextEncoder();

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
    const { url, protocols, WebSocket } = this.#options;
    try {
      this.#socket = new WebSocket(
        typeof url === 'function' ? url() : url,
        protocols,
      );
    } catch (cause) {
      this.#detach();
      this.#logger.error('WebSocketAdapter failed to start.', cause);
      throw cause;
    }
    const socket = this.#socket;
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      if (!this.#handlers) return;
      this.#logger.debug('WebSocketAdapter opened.');
      this.#handlers.onOpen();
    };
    socket.onerror = (cause) => this.#error(cause);
    socket.onmessage = ({ data }) => {
      if (typeof data === 'string') {
        this.#handlers?.onMessage(data);
      } else if (data instanceof ArrayBuffer) {
        this.#handlers?.onMessage(new Uint8Array(data));
      } else {
        try {
          this.#error(new TypeError('Expected text or ArrayBuffer data.'));
        } finally {
          this.close();
        }
      }
    };
    socket.onclose = ({ code, reason, wasClean }) => {
      const handlers = this.#handlers;
      this.#detach();
      if (handlers) {
        const close = { code, reason, clean: wasClean };
        this.#logger.debug('WebSocketAdapter closed.', close);
        handlers.onClose(close);
      }
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

  #error(cause) {
    if (!this.#handlers) return;
    this.#logger.error('WebSocketAdapter error.', cause);
    this.#handlers.onError(cause);
  }

  #detach() {
    this.#stopped = true;
    this.#handlers = null;
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return;

    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }
}
