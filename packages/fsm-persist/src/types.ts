import type {
  FsmConfig,
  FsmEvent,
  FsmSnapshot,
  FsmSubscribable,
  HierarchyConfigLike,
  HierarchyNodeSnapshotLike,
  HierarchySnapshotLike,
  Logger,
} from '@bazariodev/fsm';

export type PersistStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
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

export type {
  FsmConfig,
  FsmEvent,
  FsmSnapshot,
  FsmSubscribable,
  HierarchyConfigLike,
  HierarchyNodeSnapshotLike,
  HierarchySnapshotLike,
  Logger,
};
