/// <reference lib="esnext.disposable" />

export type Unsubscribe = () => void;
export type RealtimeState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'backoff'
  | 'stopped';
export type RealtimeContext = Readonly<{ attempt: number }>;
export type RealtimeSnapshot = Readonly<{
  value: RealtimeState;
  previousValue: RealtimeState | null;
  context: RealtimeContext;
  version: number;
  connectivity?: ConnectivityState;
  suspended?: boolean;
}>;
export type ConnectivityState = 'online' | 'offline';
export interface RealtimeConnectivitySource {
  getSnapshot(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): Unsubscribe;
}
export type RealtimeLogger = Readonly<{
  debug: (message: string, metadata?: unknown) => void;
  warn: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
}>;
export type RealtimeScheduler = Readonly<{
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;

export type RealtimeLifecycleEvent =
  | Readonly<{ type: 'CONNECT' }>
  | Readonly<{ type: 'RECONNECT' }>
  | Readonly<{ type: 'SUSPEND' }>
  | Readonly<{ type: 'DISCONNECT' }>
  | Readonly<{ type: 'READY' }>
  | Readonly<{ type: 'FAIL' }>
  | Readonly<{ type: 'RETRY' }>
  | Readonly<{ type: 'STOP' }>;
/**
 * Must start in idle with context.attempt equal to 0. send() commits and
 * publishes synchronously. Each snapshot reference stays stable for that
 * commit. Subscriptions are future-only; unsubscribe is idempotent and does
 * not throw. With connectivity, accept SUSPEND from idle, connecting, ready,
 * and backoff. It returns to idle and keeps context.attempt. Also accept
 * DISCONNECT from idle and reset context.attempt.
 */
export interface RealtimeLifecycle {
  readonly state: RealtimeState;
  /** The same reference is returned until the next committed transition. */
  readonly snapshot: RealtimeSnapshot;
  send(event: RealtimeLifecycleEvent): void;
  /** Future-only subscription. */
  subscribe(listener: (snapshot: RealtimeSnapshot) => void): Unsubscribe;
}

export type ReadyInfo = Readonly<{ reason: 'initial' | 'reconnect' }>;
export type RealtimeEventMap<TMessage = unknown> = Readonly<{
  ready: ReadyInfo;
  message: TMessage;
  error: unknown;
  state: RealtimeSnapshot;
}>;
type EmitArguments<Events extends object> = {
  [Type in keyof Events]: [type: Type, payload: Events[Type]];
}[keyof Events];
export interface RealtimeEventPublisher<
  Events extends object = RealtimeEventMap,
> {
  /**
   * Keep registration order and deduplicate the same function per event.
   * Duplicate registration returns the same idempotent, non-throwing
   * unsubscribe function.
   */
  on<Type extends keyof Events>(
    type: Type,
    listener: (payload: Events[Type]) => void,
  ): Unsubscribe;
  /** Isolate listener errors and stop later delivery when stop() is called. */
  emit(...args: EmitArguments<Events>): void;
  /** Terminal and idempotent. Later registrations are inert. */
  stop(): void;
}

export type RealtimeTransportHandlers<TMessage> = Readonly<{
  onOpen: () => void;
  onMessage: (message: TMessage) => void;
  /** Report diagnostics. This does not end the transport attempt. */
  onError: (cause: unknown) => void;
  /** Report the end of this attempt. The client can then reconnect. */
  onClose: (
    close: Readonly<{ code?: number; reason?: string; clean: boolean }>,
  ) => void;
}>;
export interface RealtimeTransport<TMessage = unknown> {
  /**
   * Start once. Do not call handlers before start(); synchronous callbacks
   * during start() are allowed.
   */
  start(handlers: RealtimeTransportHandlers<TMessage>): void;
  send(message: TMessage): void;
  /** Idempotent. Detach handlers and release the attempt. */
  [Symbol.dispose](): void;
}
/** Return a fresh, unstarted transport for each attempt. */
export type RealtimeTransportFactory<TMessage = unknown> =
  () => RealtimeTransport<TMessage>;

export type RealtimeKeepaliveChannel<TMessage = unknown> = Readonly<{
  send: (message: TMessage) => boolean;
  onMessage: (listener: (message: TMessage) => void) => Unsubscribe;
}>;
export type RealtimeMonitorFailure =
  | Readonly<{ type: 'timeout' }>
  | Readonly<{ type: 'error'; error: unknown }>;
export interface RealtimeMonitor {
  start(): void;
  activity(): void;
  probeNow(): void;
  onFail(listener: (cause: RealtimeMonitorFailure) => void): Unsubscribe;
  stop(): void;
}
export type RealtimeMonitorFactory<TMessage = unknown> = (
  channel: RealtimeKeepaliveChannel<TMessage>,
) => RealtimeMonitor;
export type RealtimeRetry = Readonly<{
  schedule: (attempt: number, callback: () => void) => Unsubscribe;
}>;

export type RealtimeClientDeps<TMessage = unknown> = Readonly<{
  fsm: RealtimeLifecycle;
  events: RealtimeEventPublisher<RealtimeEventMap<TMessage>>;
  createTransport: RealtimeTransportFactory<TMessage>;
  retry?: RealtimeRetry | null;
  createKeepalive?: RealtimeMonitorFactory<TMessage> | null;
  scheduler?: RealtimeScheduler;
  connectTimeoutMs?: number;
  logger?: RealtimeLogger;
  connectivity?: RealtimeConnectivitySource;
}>;

export declare class RealtimeClient<TMessage = unknown> implements Disposable {
  constructor(deps: RealtimeClientDeps<TMessage>);
  readonly snapshot: RealtimeSnapshot;
  readonly state: RealtimeState;
  connect(): void;
  reconnect(): void;
  disconnect(): void;
  probeNow(): void;
  send(message: TMessage): boolean;
  subscribe(listener: (snapshot: RealtimeSnapshot) => void): Unsubscribe;
  onReady(listener: (info: ReadyInfo) => void): Unsubscribe;
  onMessage(listener: (message: TMessage) => void): Unsubscribe;
  onError(listener: (cause: unknown) => void): Unsubscribe;
  stop(): void;
  [Symbol.dispose](): void;
}

export type JsonTransportLogger = Readonly<{
  warn: (message: string, metadata?: unknown) => void;
}>;
export type JsonTransportOptions = Readonly<{
  maxIncomingBytes?: number;
  warn?: JsonTransportLogger['warn'];
}>;
export declare class JsonTransport implements RealtimeTransport<unknown> {
  constructor(
    transport: RealtimeTransport<string | Uint8Array>,
    options?: JsonTransportOptions,
  );
  start(handlers: RealtimeTransportHandlers<unknown>): void;
  send(value: unknown): void;
  [Symbol.dispose](): void;
}

export type RealtimeProbe = (signal: AbortSignal) => Promise<void>;
export type RealtimeKeepaliveOptions = Readonly<{
  probe: RealtimeProbe;
  idleMs: number | (() => number);
  deadlineMs: number;
}>;
export type ReconnectJitterOptions = Readonly<{
  minRatio?: number;
  maxRatio?: number;
  /** Called without a receiver. Must return a number in [0, 1). */
  random?: () => number;
}>;
export type ReconnectOptions = Readonly<{
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: ReconnectJitterOptions | false;
}>;
export type RealtimeClientOptions<TMessage = unknown> = Readonly<{
  createTransport: RealtimeTransportFactory<TMessage>;
  fsm?: RealtimeLifecycle;
  events?: RealtimeEventPublisher<RealtimeEventMap<TMessage>>;
  retry?: RealtimeRetry | null;
  createKeepalive?: RealtimeMonitorFactory<TMessage> | null;
  keepalive?: RealtimeKeepaliveOptions;
  scheduler?: RealtimeScheduler;
  connectTimeoutMs?: number;
  reconnect?: ReconnectOptions;
  /** Fallback when reconnect.jitter.random is undefined. */
  random?: () => number;
  logger?: RealtimeLogger;
  connectivity?: RealtimeConnectivitySource;
}>;

export declare function createRealtimeClient<TMessage = unknown>(
  options: RealtimeClientOptions<TMessage>,
): RealtimeClient<TMessage>;
