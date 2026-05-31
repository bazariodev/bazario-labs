import type { FsmEvent, FsmSnapshot, Logger } from '@bazariodev/fsm';

export type Resolvable<T, TState extends string, TContext> =
  | T
  | ((snapshot: FsmSnapshot<TState, TContext>) => T);

export type AfterSpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  after: Resolvable<number, TState, TContext>;
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;
}>;

export type EverySpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  every: Resolvable<number, TState, TContext>;
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;
}>;

export type DelaySpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = AfterSpec<TState, TEvent, TContext> | EverySpec<TState, TEvent, TContext>;

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
