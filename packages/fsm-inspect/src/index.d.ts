// biome-ignore-all lint/correctness/noUnusedPrivateClassMembers: `#private` brands InspectRecorder, so a look-alike object is rejected at compile time as at runtime.

import type {
  DiagramTransitionDefinition,
  DiagramTransitionEntry,
  FsmConfig,
  FsmDiagramConfig,
  FsmEvent,
  FsmSubscribable,
  HierarchyDiagramConfig,
  Logger,
} from '@bazariodev/fsm';

/** One timeline entry. Contexts, events, snapshots, and `meta` are stored by reference after redaction. */
export type InspectEntry =
  | Readonly<{
      type: 'init';
      at: number;
      name: string;
      state: string;
      context: unknown;
    }>
  | Readonly<{
      type: 'transition-start';
      at: number;
      name: string;
      attemptId: number;
      from: string;
      to: string;
      eventType: string;
      event: unknown;
      contextBefore: unknown;
    }>
  | Readonly<{
      type: 'transition';
      at: number;
      name: string;
      attemptId: number;
      from: string;
      to: string;
      eventType: string;
      event: unknown;
      contextBefore: unknown;
      contextAfter: unknown;
    }>
  | Readonly<{
      type: 'commit';
      at: number;
      name: string;
      label: string;
      snapshot: unknown;
    }>
  | Readonly<{
      type: 'log';
      at: number;
      level: 'debug' | 'warn' | 'error';
      message: string;
      meta?: unknown;
    }>;

/** The `map*` hooks redact what each capture path stores; all default to identity. */
export type InspectRecorderOptions = Readonly<{
  /** Maximum entries kept; the oldest drops first. Default 500. */
  limit?: number;
  now?: () => number;
  mapContext?: (context: unknown) => unknown;
  mapSnapshot?: (snapshot: unknown) => unknown;
  mapEvent?: (event: unknown) => unknown;
  mapMeta?: (meta: unknown) => unknown;
  /** Called with each stored entry; a throw is ignored. */
  onEntry?: (entry: InspectEntry) => void;
}>;

export type RecordSourceOptions<_TSnapshot> = Readonly<{
  name: string;
  /** Receives the mapped snapshot. Default: its string `value`, else its string `path`, else `"snapshot"`. */
  label?: (snapshot: unknown) => string;
}>;

export type RecordSourceSubscription = Readonly<{
  /** Unsubscribe; recorded entries remain. Idempotent. */
  stop: () => void;
}>;

export type MermaidOptions = Readonly<{
  /** Draw wildcard transitions as a note (default) or as edges from every state without its own entry for the event. */
  wildcard?: 'note' | 'expand';
}>;

export type {
  DiagramTransitionDefinition,
  DiagramTransitionEntry,
  FsmConfig,
  FsmDiagramConfig,
  FsmEvent,
  FsmSubscribable,
  HierarchyDiagramConfig,
  Logger,
};

/** A bounded, fail-silent timeline: a throwing clock, hook, or `onEntry` never reaches the observed machine. */
export declare class InspectRecorder {
  #private;
  /** Throws if `limit` is not an integer >= 1 or a provided hook is not a function. */
  constructor(options?: InspectRecorderOptions);
  /** Oldest first; a frozen copy, cached until the next write. */
  get entries(): ReadonlyArray<InspectEntry>;
  /** A `Logger` that appends `log` entries; pass it to any FSM-family package. */
  get logger(): Logger;
  /** Append a caller-built entry as a shallow-frozen copy. */
  record(entry: InspectEntry): void;
  /** Monotonic across everything this recorder observes. */
  nextAttemptId(): number;
  clear(): void;
}

/**
 * Return a copy of `config` that also records `init`, `transition-start`, and `transition`
 * entries. Only the transition hooks and each state's `onEnter` are wrapped; the input is never mutated.
 */
export declare function instrumentFsmConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: FsmConfig<TState, TEvent, TContext>,
  recorder: InspectRecorder,
): FsmConfig<TState, TEvent, TContext>;

/** Record a `commit` entry for the attach-time snapshot and for each delivered one. */
export declare function recordSource<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
  recorder: InspectRecorder,
  options: RecordSourceOptions<TSnapshot>,
): RecordSourceSubscription;

/** Render a `stateDiagram-v2` diagram. Throws if the config references an undeclared state. */
export declare function mermaidFromFsmConfig(
  config: FsmDiagramConfig,
  options?: MermaidOptions,
): string;

/** Render a `stateDiagram-v2` diagram with children as nested composite states. */
export declare function mermaidFromHierarchyConfig(
  config: HierarchyDiagramConfig,
  options?: MermaidOptions,
): string;
