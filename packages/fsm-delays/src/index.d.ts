/// <reference lib="esnext.disposable" />

import type { FsmCore, FsmEvent, FsmSnapshot, Logger } from '@bazariodev/fsm';
import type { EffectsConfig } from '@bazariodev/fsm-effects';

/** A value, or a function of the snapshot resolved once at state entry. */
export type Resolvable<T, TState extends string, TContext> =
  | T
  | ((snapshot: FsmSnapshot<TState, TContext>) => T);

export type AfterSpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  after: Resolvable<number, TState, TContext>;
  every?: never;
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;
}>;

export type EverySpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  every: Resolvable<number, TState, TContext>;
  after?: never;
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;
}>;

export type DelaySpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = AfterSpec<TState, TEvent, TContext> | EverySpec<TState, TEvent, TContext>;

/** Timer functions; inject a stub for deterministic tests. Defaults to the global timers. */
export type Scheduler = Readonly<{
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}>;

export type DelaysConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  delays: Partial<
    Record<
      TState | '*',
      | DelaySpec<TState, TEvent, TContext>
      | ReadonlyArray<DelaySpec<TState, TEvent, TContext>>
    >
  >;
  scheduler?: Scheduler;
  logger?: Logger;
}>;

/** Arms each state's delays on entry and cancels them when the state is left. */
export declare class FsmDelays<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> {
  /** Throws if the delays map or a delay spec is invalid. */
  constructor(
    machine: FsmCore<TState, TEvent, TContext>,
    config: DelaysConfig<TState, TEvent, TContext>,
  );
  /** Cancel pending timers and unsubscribe. Idempotent. */
  stop(): void;
  [Symbol.dispose](): void;
}

/** Compile delays into an `effects` map for composing with other effects in one `FsmEffects`. */
export declare function compileDelays<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: DelaysConfig<TState, TEvent, TContext>,
): EffectsConfig<TState, TEvent, TContext>['effects'];
