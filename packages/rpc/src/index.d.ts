/// <reference lib="esnext.disposable" />

type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };
type ChannelState = 'idle' | 'connecting' | 'ready' | 'backoff' | 'stopped';

/** Consumer-owned realtime client. RealtimeClient satisfies this contract. */
export type RpcChannel = Readonly<{
  readonly state: ChannelState;
  /** Write one flat frame. Return false or throw if the write fails. */
  send: (
    message: Readonly<{ method: string; params?: JsonValue; id?: string }>,
  ) => boolean;
  /** Deliver decoded frames. The client does not validate incoming data. */
  onMessage: (listener: (message: unknown) => void) => () => void;
  /** Receive future snapshots. stopped is terminal. */
  subscribe: (
    listener: (snapshot: Readonly<{ value: ChannelState }>) => void,
  ) => () => void;
}>;
export type RpcRequest<Params = JsonValue> = Readonly<{
  method: string;
  params?: Params;
}>;
/** Domain payloads remain the application's responsibility to validate. */
export type RpcNotification = Readonly<{
  method: string;
  params?: JsonValue;
  [field: string]: JsonValue | undefined;
}>;
export type RpcRequestOptions = Readonly<{
  signal?: AbortSignal;
  /** Positive integer milliseconds, at most 2_147_483_647. Overrides response timeout only. */
  timeoutMs?: number;
  /** Runs once immediately before a write. Exceptions are logged; cancellation still prevents writing. */
  onWillSend?: () => void;
}>;
export type RpcClientOptions = Readonly<{
  /** The caller owns the channel. Registration returns before delivery; unsubscribe must not throw. */
  channel: RpcChannel;
  /** Fresh non-empty IDs, unique across clients and reconnects. No receiver; defaults to UUID
   * with time/random fallback. Duplicates among pending requests are rejected before writing. */
  createRequestId?: () => string;
  /** Response deadline, default 10_000 ms. Positive integer timer duration. */
  timeoutMs?: number;
  /** Maximum wait for READY, default 10_000 ms. Separate from response timeout. */
  readyTimeoutMs?: number;
  /** Includes operations waiting for READY and responses. Default 100; positive safe integer. */
  maxPending?: number;
  /** Asynchronous, non-throwing timers with opaque handles. */
  scheduler?: Readonly<{
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  }>;
  /** Must not throw. Reports notification listener and onWillSend exceptions. */
  logger?: Readonly<{ error: (message: string, metadata: unknown) => void }>;
}>;
export type RpcErrorKind =
  | 'aborted'
  | 'timeout'
  | 'disconnected'
  | 'stopped'
  | 'capacity'
  | 'id'
  | 'send'
  | 'protocol';
export declare class RpcError extends Error {
  constructor(kind: RpcErrorKind, message: string, cause?: unknown);
  readonly kind: RpcErrorKind;
}
export type RpcErrorData = Readonly<{
  code: string | number;
  message?: string;
  data?: JsonValue;
}>;
/** A matched server error. It proves a response arrived, not that the operation succeeded. */
export declare class RpcResponseError extends Error {
  constructor(error: RpcErrorData, method: string);
  readonly code: string | number;
  readonly data: JsonValue | undefined;
  readonly method: string;
}

export declare class RpcClient implements Disposable {
  constructor(options: RpcClientOptions);
  readonly pendingCount: number;
  /** Wait for READY, write once, then resolve result or reject the matched error.
   * IDs are internal. Results default to unknown; a type argument is not runtime validation. */
  request<Result = unknown, Params extends JsonValue = JsonValue>(
    request: RpcRequest<Params>,
    options?: RpcRequestOptions,
  ): Promise<Result>;
  /** Write without an ID. Resolves on local admission, not delivery or acknowledgement. */
  notify(notification: RpcRequest, options?: RpcRequestOptions): Promise<void>;
  onNotification(listener: (notification: RpcNotification) => void): () => void;
  /** Resolve on either a matched result or server error; reject timeout, abort and local failures. */
  probe(request: RpcRequest, options?: RpcRequestOptions): Promise<void>;
  /** Reject outstanding work and unsubscribe; never close the caller-owned channel. */
  stop(): void;
  [Symbol.dispose](): void;
}
