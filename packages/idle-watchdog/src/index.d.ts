/// <reference lib="esnext.disposable" />

export type Unsubscribe = () => void;

/** Platform-style asynchronous timers. Methods must not throw. Handles are opaque. */
export type TimeoutScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;

/** Optional diagnostics; error must not throw. Defaults to a no-op logger. */
export type IdleWatchdogLogger = Readonly<{
  error: (message: string, metadata?: unknown) => void;
}>;

export type IdleWatchdogOptions = Readonly<{
  /** Fixed integer duration in milliseconds, from 1 through 2_147_483_647 inclusive. */
  idleMs: number;
  /** Defaults to platform timers. Injecting a scheduler does not change the allowed range. */
  scheduler?: TimeoutScheduler;
  logger?: IdleWatchdogLogger;
}>;

/** Dependency-free, one-shot inactivity timer. Construction does not arm it. */
export declare class IdleWatchdog implements Disposable {
  /** Throws RangeError unless idleMs is an integer in [1, 2_147_483_647]. */
  constructor(options: IdleWatchdogOptions);
  /** Start a fresh inactivity window from now, replacing any pending one. Inert after stop. */
  arm(): void;
  /** Disarm without stopping. A later arm() starts a fresh window. */
  cancel(): void;
  /**
   * Subscribe in registration order. Duplicate functions share one subscription.
   * Unsubscribe is idempotent and cannot remove a later registration of that function.
   */
  onIdle(listener: () => void): Unsubscribe;
  /** Permanently disarm and clear listeners, including remaining delivery in progress. */
  stop(): void;
  [Symbol.dispose](): void;
}
