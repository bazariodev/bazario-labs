/// <reference lib="esnext.disposable" />
import type { TimeoutScheduler } from '@bazariodev/idle-watchdog';

export type Unsubscribe = () => void;

/** Platform-style timers with opaque handles and non-throwing methods. */
export type KeepaliveScheduler = TimeoutScheduler;

/** Verify the connection with a fresh abortable request. Fulfill after validation. */
export type KeepaliveProbe = (signal: AbortSignal) => Promise<void>;

/** One terminal failure per instance. Error failures preserve the original cause. */
export type KeepaliveFailure =
  | Readonly<{ type: 'timeout' }>
  | Readonly<{ type: 'error'; error: unknown }>;

/** Must not throw. Reports failure-listener exceptions with their original cause. */
export type KeepaliveLogger = Readonly<{
  error: (message: string, metadata?: unknown) => void;
}>;

export type KeepaliveOptions = Readonly<{
  probe: KeepaliveProbe;
  /** Inactivity before a probe, in integer milliseconds from 1 to 2_147_483_647. */
  idleMs: number | (() => number);
  /** Maximum response wait, in integer milliseconds from 1 to 2_147_483_647. */
  deadlineMs: number;
  scheduler?: KeepaliveScheduler;
  logger?: KeepaliveLogger;
}>;

/** One abortable probe and two watchdogs. Construction does not start work. */
export declare class Keepalive implements Disposable {
  /** Invalid fixed durations throw RangeError. Construction does not start work. */
  constructor(options: KeepaliveOptions);
  /** Start idle monitoring once. Inert after stop or failure. */
  start(): void;
  /** Reset the idle window when started and no probe is active. */
  activity(): void;
  /** Start a probe now. Repeated or re-entrant requests coalesce. */
  probeNow(): void;
  /** Register one terminal failure listener. Delivery finishes if a listener calls stop(). */
  onFail(listener: (failure: KeepaliveFailure) => void): Unsubscribe;
  /** Stop permanently, cancel timers, abort active work, and clear listeners silently. */
  stop(): void;
  [Symbol.dispose](): void;
}
