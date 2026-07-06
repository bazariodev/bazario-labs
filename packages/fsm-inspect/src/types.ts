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

export type InspectRecorderOptions = Readonly<{
  limit?: number;
  now?: () => number;
  mapContext?: (context: unknown) => unknown;
  mapSnapshot?: (snapshot: unknown) => unknown;
  mapEvent?: (event: unknown) => unknown;
  mapMeta?: (meta: unknown) => unknown;
  onEntry?: (entry: InspectEntry) => void;
}>;

export type RecordSourceOptions<_TSnapshot> = Readonly<{
  name: string;
  label?: (snapshot: unknown) => string;
}>;

export type RecordSourceSubscription = Readonly<{
  stop: () => void;
}>;

export type MermaidOptions = Readonly<{
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
