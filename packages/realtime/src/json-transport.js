const DEFAULT_MAX_INCOMING_BYTES = 1_048_576;
const UTF8_ENCODER = new TextEncoder();

/** Convert raw text frames to JavaScript values at the transport boundary. */
export class JsonTransport {
  #transport;
  #logger;
  #maxIncomingBytes;
  #handlers = null;
  #disposed = false;

  constructor(transport, options = {}) {
    if (!transport || typeof transport.start !== 'function')
      throw new TypeError('transport must provide start');
    if (typeof transport.send !== 'function')
      throw new TypeError('transport must provide send');
    if (typeof transport[Symbol.dispose] !== 'function')
      throw new TypeError('transport must provide Symbol.dispose');
    const { maxIncomingBytes = DEFAULT_MAX_INCOMING_BYTES } = options;
    if (!Number.isSafeInteger(maxIncomingBytes) || maxIncomingBytes <= 0)
      throw new TypeError('maxIncomingBytes must be a positive safe integer');
    this.#transport = transport;
    this.#logger = options;
    this.#maxIncomingBytes = maxIncomingBytes;
  }

  start(handlers) {
    if (this.#handlers || this.#disposed)
      throw new Error('A JSON transport can only be started once.');
    this.#handlers = handlers;
    this.#transport.start({
      onOpen: () => this.#handlers?.onOpen(),
      onMessage: (frame) => this.#onMessage(frame),
      onError: (cause) => this.#handlers?.onError(cause),
      onClose: (close) => this.#handlers?.onClose(close),
    });
  }

  send(value) {
    if (this.#disposed) throw new Error('JSON transport is disposed.');
    const frame = JSON.stringify(value);
    if (typeof frame !== 'string')
      throw new TypeError('message is not JSON serializable');
    if (this.#disposed) throw new Error('JSON transport is disposed.');
    this.#transport.send(frame);
  }

  [Symbol.dispose]() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#handlers = null;
    this.#transport[Symbol.dispose]();
  }

  #onMessage(frame) {
    if (this.#disposed) return;
    if (typeof frame !== 'string') {
      this.#warn('Expected a text JSON frame.');
      return;
    }
    if (
      frame.length > this.#maxIncomingBytes ||
      UTF8_ENCODER.encode(frame).byteLength > this.#maxIncomingBytes
    ) {
      this.#warn('JSON frame exceeds the incoming byte limit.');
      return;
    }

    let value;
    try {
      value = JSON.parse(frame);
    } catch (cause) {
      this.#warn('Could not parse a JSON frame.', cause);
      return;
    }
    this.#handlers?.onMessage(value);
  }

  #warn(message, cause) {
    try {
      this.#logger.warn?.(message, cause ? { cause } : undefined);
    } catch {}
  }
}
