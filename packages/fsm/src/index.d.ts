export type FsmEvent = {
  type: string;
};

export type FsmSnapshot<TState extends string, TContext> = Readonly<{
  value: TState;
  previousValue: TState | null;
  context: Readonly<TContext>;
  version: number;
}>;

export type FsmSubscribable<TSnapshot> = Readonly<{
  snapshot: TSnapshot;
  subscribe: (listener: (snapshot?: TSnapshot) => void) => Unsubscribe;
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
  Partial<
    Record<
      TState | '*',
      Readonly<
        Partial<
          Record<TEvent['type'], TransitionEntry<TState, TEvent, TContext>>
        >
      >
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
> = TransitionStartPayload<TState, TEvent, TContext>;

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

export type HierarchyNodeSnapshotLike = Readonly<{
  value: string;
  context: unknown;
  child: HierarchyNodeSnapshotLike | null;
}>;

export type HierarchySnapshotLike = Readonly<{
  root: HierarchyNodeSnapshotLike;
}>;

export type HierarchyConfigLike = Readonly<{
  name: string;
  initial: string;
  context: unknown;
  states: Record<string, unknown>;
  children?: Partial<Record<string, HierarchyConfigLike>>;
}>;

export type DiagramTransitionDefinition = Readonly<{
  target: string;
  guard?: unknown;
}>;

export type DiagramTransitionEntry =
  | DiagramTransitionDefinition
  | ReadonlyArray<DiagramTransitionDefinition>;

export type FsmDiagramConfig = Readonly<{
  name?: string;
  initial: string;
  states: Record<string, unknown>;
  transitions: Readonly<
    Partial<Record<string, Readonly<Partial<Record<string, unknown>>>>>
  >;
}>;

export type HierarchyDiagramConfig = FsmDiagramConfig &
  Readonly<{ children?: Partial<Record<string, HierarchyDiagramConfig>> }>;

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

/** Synchronous finite state machine: one active state, frozen snapshots, post-commit subscriptions. */
export declare class Fsm<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> implements FsmCore<TState, TEvent, TContext>
{
  /** Throws if the state graph is invalid or the initial state's onEnter throws. */
  constructor(config: FsmConfig<TState, TEvent, TContext>);
  readonly name: string;
  readonly snapshot: FsmSnapshot<TState, TContext>;
  readonly state: TState;
  readonly context: Readonly<TContext>;
  /** Throws if called while a transition is in progress, or rethrows a guard, reducer, or hook error. */
  send(event: TEvent): void;
  can(event: TEvent): boolean;
  subscribe(listener: FsmSubscriber<TState, TContext>): Unsubscribe;
}
