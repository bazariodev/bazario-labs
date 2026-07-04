import type {
  FsmConfig,
  FsmCore,
  FsmEvent,
  Logger,
  Unsubscribe,
} from '@bazariodev/fsm';

export type HierarchyConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = FsmConfig<TState, TEvent, TContext> & {
  children?: Partial<Record<TState, AnyHierarchyConfig<TEvent>>>;
};

export type AnyHierarchyConfig<TEvent extends FsmEvent> = Readonly<{
  name: string;
  initial: string;
  context: unknown;
  states: Record<string, unknown>;
  transitions: Readonly<
    Record<string, Readonly<Partial<Record<TEvent['type'], unknown>>>>
  >;
  onTransitionStart?: unknown;
  onTransitionBeforeCommit?: unknown;
  logger?: Logger;
  children?: Partial<Record<string, AnyHierarchyConfig<TEvent>>>;
}>;

export type HierarchyNode<TEvent extends FsmEvent> = Readonly<{
  path: string;
  handle: FsmCore<string, TEvent, unknown>;
}>;

export type HierarchyNodeCleanup = () => void;

export type HierarchyNodeSnapshot = Readonly<{
  value: string;
  context: unknown;
  version: number;
  path: string;
  child: HierarchyNodeSnapshot | null;
}>;

export type HierarchySnapshot = Readonly<{
  treeVersion: number;
  path: string;
  root: HierarchyNodeSnapshot;
}>;

export type HierarchySubscriber = (snapshot: HierarchySnapshot) => void;

export type FsmHierarchyOptions<TEvent extends FsmEvent> = Readonly<{
  logger?: Logger;
  onNodeSpawned?: (node: HierarchyNode<TEvent>) => void | HierarchyNodeCleanup;
}>;

export type { Unsubscribe };
