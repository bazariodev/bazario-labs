/// <reference lib="esnext.disposable" />
/// <reference lib="dom" />

export type TransportMessage = string | Uint8Array;

/** Optional diagnostics. Methods must not throw. Compatible with other Bazario package loggers. */
export type Logger = Readonly<{
  debug: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}>;

export type TransportClose = Readonly<{
  code?: number;
  reason?: string;
  clean: boolean;
}>;

/** Handlers must not throw; an exception from a handler has adapter-specific effects. */
export type TransportHandlers = Readonly<{
  onOpen: () => void;
  onMessage: (message: TransportMessage) => void;
  /** Diagnostic only; onClose marks the end of the attempt. */
  onError: (cause: unknown) => void;
  onClose: (close: TransportClose) => void;
}>;

/** One ordered duplex connection attempt. Create a new instance to reconnect. */
export interface Transport {
  /** Start once. A synchronous failure is terminal, silent, and rethrows the original error. */
  start(handlers: TransportHandlers): void;
  /** Accept a local write, or throw. Later async failures use onError/onClose. No delivery guarantee. */
  send(message: TransportMessage): void;
  /** Terminal even before start. onClose is asynchronous and suppressed by disposal. */
  close(): void;
  /** Release the connection and handlers without further notifications. */
  [Symbol.dispose](): void;
}

export type TransportFactory = () => Transport;

export type WebSocketAdapterOptions = Readonly<{
  /** Lifecycle and error logger. Defaults to no-op. */
  logger?: Logger;
  /** Resolved when start() is called. */
  url: string | (() => string);
  protocols?: string | ReadonlyArray<string>;
  /** Maximum projected buffered bytes. Defaults to 1 MiB. */
  maxBufferedBytes?: number;
  /** Native or compatible WebSocket constructor; instantiated at start(). */
  WebSocket?: new (
    url: string,
    protocols?: string | string[],
  ) => WebSocket;
}>;

/** One browser WebSocket connection attempt. */
export declare class WebSocketAdapter implements Transport {
  constructor(options: WebSocketAdapterOptions);
  /** May throw if URL resolution or WebSocket construction fails. */
  start(handlers: TransportHandlers): void;
  /** Throws if not open, above the buffer limit, or if the platform write fails. */
  send(message: TransportMessage): void;
  close(): void;
  [Symbol.dispose](): void;
}

export type HttpAdapterOptions = Readonly<{
  /** Lifecycle and error logger. Defaults to no-op. */
  logger?: Logger;
  /** GET and POST endpoint identifying one attempt. Resolved at start(). */
  url: string | (() => string);
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  /** Maximum incoming or outgoing payload size. Defaults to 1 MiB. */
  maxMessageBytes?: number;
  /** Maximum outstanding frame bytes, including headers. Defaults to 1 MiB. */
  maxBufferedBytes?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}>;

/** One framed streaming GET with ordered, framed POST writes to the same URL. */
export declare class HttpAdapter implements Transport {
  constructor(options: HttpAdapterOptions);
  start(handlers: TransportHandlers): void;
  /** Accept into the bounded POST buffer, or throw. HTTP failures notify asynchronously. */
  send(message: TransportMessage): void;
  /** Abort requests and discard pending writes. Notify onClose asynchronously unless disposed. */
  close(): void;
  [Symbol.dispose](): void;
}

export type WebTransportAdapterOptions = Readonly<{
  /** Lifecycle and error logger. Defaults to no-op. */
  logger?: Logger;
  /** HTTPS endpoint, resolved at start(). */
  url: string | (() => string);
  sessionOptions?: WebTransportOptions;
  /** Maximum incoming or outgoing payload size. Defaults to 1 MiB. */
  maxMessageBytes?: number;
  /** Maximum outstanding frame bytes, including headers. Defaults to 1 MiB. */
  maxBufferedBytes?: number;
  /** Native or compatible WebTransport constructor; instantiated at start(). */
  WebTransport?: new (
    url: string,
    options?: WebTransportOptions,
  ) => WebTransport;
}>;

/** One WebTransport session using one reliable bidirectional stream of frames. */
export declare class WebTransportAdapter implements Transport {
  constructor(options: WebTransportAdapterOptions);
  start(handlers: TransportHandlers): void;
  /** Accept into the stream writer, or throw. Later write failures notify asynchronously. */
  send(message: TransportMessage): void;
  /** Cancel the stream and close the session. Notify onClose asynchronously unless disposed. */
  close(): void;
  [Symbol.dispose](): void;
}
