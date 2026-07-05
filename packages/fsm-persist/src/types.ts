import type { FsmConfig, FsmEvent, FsmSnapshot, Logger } from '@bazariodev/fsm';

export type PersistStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

export type FsmSubscribable<TSnapshot> = Readonly<{
  snapshot: TSnapshot;
  subscribe: (listener: () => void) => () => void;
}>;

export type PersistedFsmState = Readonly<{
  kind: 'fsm';
  value: string;
  context: unknown;
}>;

export type PersistedHierarchyState = Readonly<{
  kind: 'hierarchy';
  spine: ReadonlyArray<Readonly<{ value: string; context: unknown }>>;
}>;

export type PersistedState = PersistedFsmState | PersistedHierarchyState;

export type PersistRecord = Readonly<{
  format: 1;
  name: string;
  at: number;
  state: PersistedState;
}>;

export type PersistOptions<TSnapshot> = Readonly<{
  storage: PersistStorage;
  key: string;
  name: string;
  filter?: (snapshot: TSnapshot) => boolean;
  serialize?: (record: PersistRecord) => string;
  logger?: Logger;
  now?: () => number;
}>;

export type RestoreOptions = Readonly<{
  storage: PersistStorage;
  key: string;
  name?: string;
  maxAgeMs?: number;
  deserialize?: (raw: string) => unknown;
  logger?: Logger;
  now?: () => number;
}>;

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

export type RestoreFsmResult<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  config: FsmConfig<TState, TEvent, TContext>;
  restored: boolean;
}>;

export type RestoreHierarchyResult<TConfig extends HierarchyConfigLike> =
  Readonly<{
    config: TConfig;
    restored: boolean;
    restoredLevels: number;
    recordLevels: number;
  }>;

export type { FsmConfig, FsmEvent, FsmSnapshot, Logger };
