import { Fsm, type FsmSnapshot } from '@bazariodev/fsm';
import {
  type AnyHierarchyConfig,
  FsmHierarchy,
  type HierarchySnapshot,
} from '@bazariodev/fsm-hierarchy';
import {
  FsmPersist,
  type HierarchyConfigLike,
  type HierarchySnapshotLike,
  loadRecord,
  type PersistedState,
  type PersistOptions,
  type PersistRecord,
  type PersistStorage,
  persistFsm,
  persistHierarchy,
  type RestoreFsmResult,
  type RestoreHierarchyResult,
  restoreFsmConfig,
  restoreHierarchyConfig,
} from '../index.js';

type State = 'idle' | 'connected';
type Event = { type: 'CONNECT' };
type Context = { attempts: number };

declare const storage: PersistStorage;

const base = {
  name: 'call',
  initial: 'idle' as State,
  context: { attempts: 0 } as Context,
  states: { idle: {}, connected: {} },
  transitions: { idle: { CONNECT: { target: 'connected' as State } } },
};

// Restore by construction, then persist.
const flat: RestoreFsmResult<State, Event, Context> = restoreFsmConfig(base, {
  storage,
  key: 'call',
  maxAgeMs: 60_000,
});
const restored: boolean = flat.restored;
const machine = new Fsm<State, Event, Context>(flat.config);

const options: PersistOptions<FsmSnapshot<State, Context>> = {
  storage,
  key: 'call',
  name: 'call',
  filter: (snapshot) => snapshot.value !== 'idle',
  serialize: (record: PersistRecord) => JSON.stringify(record),
  now: () => Date.now(),
};
const persistor = persistFsm(machine, options);
persistor.clear();
persistor.stop();
persistor[Symbol.dispose]();

// The real hierarchy package fits the structural types.
const hierarchySnapshot: HierarchySnapshotLike = {} as HierarchySnapshot;
const hierarchyConfig: HierarchyConfigLike = {} as AnyHierarchyConfig<Event>;
void [hierarchySnapshot, hierarchyConfig, restored];

const tree: RestoreHierarchyResult<AnyHierarchyConfig<Event>> =
  restoreHierarchyConfig({} as AnyHierarchyConfig<Event>, {
    storage,
    key: 'tree',
  });
const levels: number = tree.restoredLevels;
const hierarchy = new FsmHierarchy<Event>(tree.config);
persistHierarchy(hierarchy, { storage, key: 'tree', name: 'call-tree' });
void levels;

const custom = new FsmPersist(
  machine,
  (snapshot): PersistedState => ({
    kind: 'fsm',
    value: snapshot.value,
    context: snapshot.context,
  }),
  { storage, key: 'custom', name: 'custom' },
);
void custom;

const record: PersistRecord | null = loadRecord({
  storage,
  key: 'call',
  name: 'call',
});
void record;

// @ts-expect-error loadRecord requires an explicit name.
loadRecord({ storage, key: 'call' });
// @ts-expect-error Storage must be string-based.
persistFsm(machine, { ...options, storage: { getItem: () => 1 } });
// @ts-expect-error A record's state kind is 'fsm' or 'hierarchy'.
const badState: PersistedState = { kind: 'other', value: 'idle', context: {} };
void badState;
