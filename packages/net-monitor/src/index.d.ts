/// <reference lib="esnext.disposable" />

export type ConnectivityState = 'online' | 'offline';
export type Unsubscribe = () => void;

export interface ConnectivitySource {
  getSnapshot(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): Unsubscribe;
}

export type BrowserNetPlatform = Readonly<{
  navigator: Readonly<{ onLine: boolean }>;
  addEventListener?: (type: 'online' | 'offline', listener: () => void) => void;
  removeEventListener?: (
    type: 'online' | 'offline',
    listener: () => void,
  ) => void;
}>;

export type BrowserNetMonitorOptions = Readonly<{
  platform?: BrowserNetPlatform;
  onListenerError?: (error: unknown) => void;
}>;

/** Observe browser online and offline hints without attaching listeners at construction. */
export declare class BrowserNetMonitor
  implements ConnectivitySource, Disposable
{
  /** Create a monitor without reading navigator.onLine or adding listeners. */
  constructor(options?: BrowserNetMonitorOptions);

  /**
   * Return the current state.
   * Read navigator.onLine when the monitor has no listeners and is active.
   * Return the saved state when it has listeners or is stopped.
   * Pass errors from platform property reads to the caller.
   * @throws {TypeError} If navigator.onLine is missing or is not a boolean.
   */
  getSnapshot(): ConnectivityState;

  /**
   * Add a listener and sample navigator.onLine while the monitor is active.
   * Return a no-op function when the monitor is stopped.
   * Pass platform read and listener setup errors to the caller.
   * If setup fails, remove this listener. Remove browser listeners only when
   * no subscriptions remain. Keep any other subscriptions.
   * @throws {TypeError} If the listener is not a function or the sample is invalid.
   */
  subscribe(listener: (state: ConnectivityState) => void): Unsubscribe;
  stop(): void;
  [Symbol.dispose](): void;
}
