/// <reference lib="esnext.disposable" />
/// <reference lib="dom" />

import type { FsmCore, FsmEvent, FsmSnapshot, Logger } from '@bazariodev/fsm';

/** Passed to every effect. `send` is a no-op once `signal` is aborted. */
export type EffectApi<TEvent extends FsmEvent> = Readonly<{
  signal: AbortSignal;
  send: (event: TEvent) => void;
}>;

export type EffectCleanup = () => void;

/** Runs when its state is entered; the returned cleanup runs when the state is left. */
export type Effect<TState extends string, TEvent extends FsmEvent, TContext> = (
  snapshot: FsmSnapshot<TState, TContext>,
  api: EffectApi<TEvent>,
) => void | EffectCleanup | Promise<void | EffectCleanup>;

export type EffectsConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  /** Effects per state; `*` effects run after the state's own effects on every state entry. */
  effects: Partial<
    Record<
      TState | '*',
      | Effect<TState, TEvent, TContext>
      | ReadonlyArray<Effect<TState, TEvent, TContext>>
    >
  >;
  logger?: Logger;
}>;

/** Runs state-scoped effects for a machine and aborts them when their state is left. */
export declare class FsmEffects<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> {
  /** Subscribes to the machine and runs the current state's effects. Throws if an effect is not a function. */
  constructor(
    machine: FsmCore<TState, TEvent, TContext>,
    config: EffectsConfig<TState, TEvent, TContext>,
  );
  /** Abort the current state's effects and unsubscribe. Idempotent. */
  stop(): void;
  [Symbol.dispose](): void;
}
