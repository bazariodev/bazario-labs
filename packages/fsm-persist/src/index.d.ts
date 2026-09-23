/// <reference lib="esnext.disposable" />

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

/** Synchronous string storage; `localStorage` and `sessionStorage` fit directly. */
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

/** The versioned envelope written to storage. */
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

/** Writes a versioned record on construction and after every commit; write failures are logged, never thrown. */
export declare class FsmPersist<TSnapshot> {
  /** Throws if the source, `toState`, or any option is malformed. */
  constructor(
    source: FsmSubscribable<TSnapshot>,
    toState: (snapshot: TSnapshot) => PersistedState,
    options: PersistOptions<TSnapshot>,
  );
  /** Remove the stored record without stopping. */
  clear(): void;
  /** Stop writing; the stored record is kept. Idempotent. */
  stop(): void;
  [Symbol.dispose](): void;
}

export declare function persistFsm<TState extends string, TContext>(
  source: FsmSubscribable<FsmSnapshot<TState, TContext>>,
  options: PersistOptions<FsmSnapshot<TState, TContext>>,
): FsmPersist<FsmSnapshot<TState, TContext>>;

export declare function persistHierarchy(
  source: FsmSubscribable<HierarchySnapshotLike>,
  options: PersistOptions<HierarchySnapshotLike>,
): FsmPersist<HierarchySnapshotLike>;

/** Read and validate the envelope only. Returns `null` for any missing, invalid, or stale record. */
export declare function loadRecord(
  options: RestoreOptions & { name: string },
): PersistRecord | null;

/** Return `config` with `initial` and `context` from storage when the record is valid; never throws on bad data. */
export declare function restoreFsmConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: FsmConfig<TState, TEvent, TContext>,
  options: RestoreOptions,
): RestoreFsmResult<TState, TEvent, TContext>;

/** Apply the stored active spine top-down; a deeper mismatch restores the valid prefix. */
export declare function restoreHierarchyConfig<
  TConfig extends HierarchyConfigLike,
>(config: TConfig, options: RestoreOptions): RestoreHierarchyResult<TConfig>;
