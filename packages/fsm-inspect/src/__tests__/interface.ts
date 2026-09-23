import { Fsm, type FsmConfig, type FsmSnapshot } from '@bazariodev/fsm';
import {
  type AnyHierarchyConfig,
  FsmHierarchy,
  type HierarchySnapshot,
} from '@bazariodev/fsm-hierarchy';
import {
  type FsmDiagramConfig,
  type FsmSubscribable,
  type HierarchyDiagramConfig,
  type InspectEntry,
  InspectRecorder,
  type InspectRecorderOptions,
  instrumentFsmConfig,
  type Logger,
  type MermaidOptions,
  mermaidFromFsmConfig,
  mermaidFromHierarchyConfig,
  type RecordSourceOptions,
  type RecordSourceSubscription,
  recordSource,
} from '../index.js';

type State = 'idle' | 'dialing';
type Event = { type: 'DIAL'; destination: string };
type Context = { attempts: number };

const options: InspectRecorderOptions = {
  limit: 1000,
  now: () => Date.now(),
  mapContext: (context) => context,
  mapSnapshot: (snapshot) => snapshot,
  mapEvent: (event) => event,
  mapMeta: (meta) => meta,
  onEntry: (entry: InspectEntry) => {
    if (entry.type === 'transition') {
      const attemptId: number = entry.attemptId;
      const after: unknown = entry.contextAfter;
      void [attemptId, after];
    }
  },
};
const recorder = new InspectRecorder(options);
const entries: ReadonlyArray<InspectEntry> = recorder.entries;
const logger: Logger = recorder.logger;
const nextId: number = recorder.nextAttemptId();
recorder.record({ type: 'log', at: 1, level: 'warn', message: 'custom' });
recorder.clear();
void [entries, nextId, new InspectRecorder()];

// Instrumentation keeps the config's own types, logger included.
const config: FsmConfig<State, Event, Context> = {
  name: 'call',
  initial: 'idle',
  context: { attempts: 0 },
  states: { idle: {}, dialing: {} },
  transitions: {
    idle: {
      DIAL: {
        target: 'dialing',
        reducer: (context) => ({ attempts: context.attempts + 1 }),
      },
    },
  },
  logger,
};
const instrumented: FsmConfig<State, Event, Context> = instrumentFsmConfig(
  config,
  recorder,
);
const machine = new Fsm(instrumented);

const subscription: RecordSourceSubscription = recordSource(machine, recorder, {
  name: 'call',
  label: (snapshot) => String(snapshot),
});
subscription.stop();
const sourceOptions: RecordSourceOptions<FsmSnapshot<State, Context>> = {
  name: 'call',
};
recordSource(machine, recorder, sourceOptions);

// The real packages fit the structural port and the diagram shapes.
const port: FsmSubscribable<FsmSnapshot<State, Context>> = machine;
const hierarchyConfig = {} as AnyHierarchyConfig<Event>;
const hierarchy = new FsmHierarchy<Event>(hierarchyConfig);
const treePort: FsmSubscribable<HierarchySnapshot> = hierarchy;
recordSource(hierarchy, recorder, { name: 'tree' });
const flatShape: FsmDiagramConfig = config;
const treeShape: HierarchyDiagramConfig = hierarchyConfig;
const mermaidOptions: MermaidOptions = { wildcard: 'expand' };
const flat: string = mermaidFromFsmConfig(config, mermaidOptions);
const tree: string = mermaidFromHierarchyConfig(hierarchyConfig);
void [port, treePort, flatShape, treeShape, flat, tree];

instrumentFsmConfig(
  config,
  // @ts-expect-error A recorder is nominal: a look-alike object is rejected.
  { entries, logger, record() {}, nextAttemptId: () => 1, clear() {} },
);
// @ts-expect-error recordSource requires a name.
recordSource(machine, recorder, {});
// @ts-expect-error Entry types are a closed union.
recorder.record({ type: 'other', at: 1 });
// @ts-expect-error The wildcard mode is 'note' or 'expand'.
mermaidFromFsmConfig(config, { wildcard: 'dense' });
// @ts-expect-error limit is a number.
void new InspectRecorder({ limit: '5' });
