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
  constructor(options?: BrowserNetMonitorOptions);
  getSnapshot(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): Unsubscribe;
  stop(): void;
  [Symbol.dispose](): void;
}
