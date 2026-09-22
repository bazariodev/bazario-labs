/// <reference lib="esnext.disposable" />

import type {
  FsmConfig,
  FsmCore,
  FsmEvent,
  Logger,
  Unsubscribe,
} from '@bazariodev/fsm';

/** A typed node config plus the child config for any of its states. */
export type HierarchyConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = FsmConfig<TState, TEvent, TContext> & {
  children?: Partial<Record<TState, AnyHierarchyConfig<TEvent>>>;
};

/** Loosely typed config accepted at the `children` boundary and by the constructor. */
export type AnyHierarchyConfig<TEvent extends FsmEvent> = Readonly<{
  name: string;
  initial: string;
  context: unknown;
  states: Record<string, unknown>;
  transitions: Readonly<
    Partial<Record<string, Readonly<Partial<Record<TEvent['type'], unknown>>>>>
  >;
  onTransitionStart?: unknown;
  onTransitionBeforeCommit?: unknown;
  logger?: Logger;
  children?: Partial<Record<string, AnyHierarchyConfig<TEvent>>>;
}>;

/** Passed to `onNodeSpawned`; `handle` is an FsmCore view whose sends route through the hierarchy. */
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

/** Nested state machines: one child machine per compound state, events routed deepest-first. */
export declare class FsmHierarchy<TEvent extends FsmEvent> {
  /** Validates the whole config tree, then spawns the initial active spine. */
  constructor(
    config: AnyHierarchyConfig<TEvent>,
    options?: FsmHierarchyOptions<TEvent>,
  );
  readonly snapshot: HierarchySnapshot;
  /** Route to the deepest active node, bubbling to parents. Throws during reconciliation. */
  send(event: TEvent): void;
  can(event: TEvent): boolean;
  /** Segment-aware path match: `a` matches `a` and `a.b`, not `ab`. */
  matches(path: string): boolean;
  subscribe(listener: HierarchySubscriber): Unsubscribe;
  /** The handle for an active node, or `undefined` if no active node has this path. */
  nodeFor(path: string): FsmCore<string, TEvent, unknown> | undefined;
  /** Dispose every node deepest-first and clear subscribers. Idempotent. */
  stop(): void;
  [Symbol.dispose](): void;
}
