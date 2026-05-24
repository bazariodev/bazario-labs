import type { FsmEvent, FsmSnapshot, Logger } from '@bazariodev/fsm';

export type EffectApi<TEvent extends FsmEvent> = Readonly<{
  signal: AbortSignal;
  send: (event: TEvent) => void;
}>;

export type EffectCleanup = () => void;

export type Effect<TState extends string, TEvent extends FsmEvent, TContext> = (
  snapshot: FsmSnapshot<TState, TContext>,
  api: EffectApi<TEvent>,
) => void | EffectCleanup | Promise<void | EffectCleanup>;

export type EffectsConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  effects: Partial<
    Record<
      TState | '*',
      | Effect<TState, TEvent, TContext>
      | ReadonlyArray<Effect<TState, TEvent, TContext>>
    >
  >;
  logger?: Logger;
}>;
