/// <reference lib="esnext.disposable" />
import type { TimeoutScheduler } from '@bazariodev/idle-watchdog';

export type Unsubscribe = () => void;

/** Shared watchdog scheduler: asynchronous timers, opaque handles, and non-throwing methods. */
export type KeepaliveScheduler = TimeoutScheduler;

/** Verify this connection with a fresh abortable request; fulfill after validation, reject on failure. */
export type KeepaliveProbe = (signal: AbortSignal) => Promise<void>;

/** At most one terminal failure per instance. Error failures preserve the original cause. */
export type KeepaliveFailure =
  | Readonly<{ type: 'timeout' }>
  | Readonly<{ type: 'error'; error: unknown }>;

/** Must not throw. Reports listener exceptions with their original cause. */
export type KeepaliveLogger = Readonly<{
  error: (message: string, metadata?: unknown) => void;
}>;

export type KeepaliveOptions = Readonly<{
  /** Inactivity before a probe. Integer milliseconds in [1, 2_147_483_647]. */
  idleMs: number;
  /** Time to await probe fulfillment. Same bounds as idleMs; never extended by activity. */
  deadlineMs: number;
  probe: KeepaliveProbe;
  scheduler?: KeepaliveScheduler;
  logger?: KeepaliveLogger;
}>;

/** Liveness orchestration over two IdleWatchdogs. Construction is inert; failure is terminal. */
export declare class Keepalive implements Disposable {
  /** Delegates duration validation to the watchdogs; invalid durations throw RangeError. */
  constructor(options: KeepaliveOptions);
  /** Start one inactivity window. Idempotent: repeated starts do not extend it or restart failure. */
  start(): void;
  /** Report validated incoming traffic; refresh idle monitoring when started with no probe pending. */
  activity(): void;
  /** Invoke a probe after start; repeated/re-entrant requests coalesce while one is pending. */
  probeNow(): void;
  /** Subscribe to terminal failure; the delivery snapshot completes even if a listener calls stop(). */
  onFail(listener: (failure: KeepaliveFailure) => void): Unsubscribe;
  /** Terminal, silent, and idempotent. Abort pending work and dispose watchdogs and listeners. */
  stop(): void;
  [Symbol.dispose](): void;
}
