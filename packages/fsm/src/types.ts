export type FsmEvent = {
  type: string;
};

export type FsmSnapshot<TState extends string, TContext> = Readonly<{
  value: TState;
  previousValue: TState | null;
  context: Readonly<TContext>;
  version: number;
}>;

export type Guard<TContext, TEvent extends FsmEvent> = (
  context: Readonly<TContext>,
  event: TEvent,
) => boolean;

export type ContextReducer<TContext, TEvent extends FsmEvent> = (
  context: Readonly<TContext>,
  event: TEvent,
) => TContext;

export type TransitionDefinition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  target: TState;
  guard?: Guard<TContext, TEvent>;
  reducer?: ContextReducer<TContext, TEvent>;
}>;

export type TransitionEntry<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> =
  | TransitionDefinition<TState, TEvent, TContext>
  | ReadonlyArray<TransitionDefinition<TState, TEvent, TContext>>;

export type TransitionMap<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<
  Record<
    TState | '*',
    Readonly<
      Partial<Record<TEvent['type'], TransitionEntry<TState, TEvent, TContext>>>
    >
  >
>;

export type TransitionStartPayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  from: TState;
  to: TState;
  event: TEvent;
  context: Readonly<TContext>;
}>;

export type TransitionCommitPayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  from: TState;
  to: TState;
  event: TEvent;
  previousContext: Readonly<TContext>;
  nextContext: Readonly<TContext>;
}>;

export type StateEnterPayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  from: TState | null;
  to: TState;
  event: TEvent | null;
  context: Readonly<TContext>;
}>;

export type StateLeavePayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  from: TState;
  to: TState;
  event: TEvent;
  context: Readonly<TContext>;
}>;

export type StateDefinition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  onEnter?: (payload: StateEnterPayload<TState, TEvent, TContext>) => void;
  onLeave?: (payload: StateLeavePayload<TState, TEvent, TContext>) => void;
}>;

export type Logger = Readonly<{
  debug: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}>;

export type FsmConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  name: string;
  initial: TState;
  context: TContext;
  states: Record<TState, StateDefinition<TState, TEvent, TContext>>;
  transitions: TransitionMap<TState, TEvent, TContext>;
  onTransitionStart?: (
    payload: TransitionStartPayload<TState, TEvent, TContext>,
  ) => void;
  onTransitionBeforeCommit?: (
    payload: TransitionCommitPayload<TState, TEvent, TContext>,
  ) => void;
  logger?: Logger;
}>;

export type FsmSubscriber<TState extends string, TContext> = (
  snapshot: FsmSnapshot<TState, TContext>,
) => void;

export type Unsubscribe = () => void;

export interface FsmCore<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> {
  readonly name: string;
  readonly snapshot: FsmSnapshot<TState, TContext>;
  readonly state: TState;
  readonly context: Readonly<TContext>;
  send(event: TEvent): void;
  can(event: TEvent): boolean;
  subscribe(listener: FsmSubscriber<TState, TContext>): Unsubscribe;
}
