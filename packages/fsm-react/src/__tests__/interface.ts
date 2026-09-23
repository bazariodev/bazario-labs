import { Fsm, type FsmSnapshot } from '@bazariodev/fsm';
import type {
  FsmHierarchy,
  HierarchySnapshot,
} from '@bazariodev/fsm-hierarchy';
import {
  type EqualityFn,
  type FsmSubscribable,
  type SnapshotOf,
  type UseFsmOptions,
  useFsm,
  useFsmSelector,
  useFsmSnapshot,
} from '../index.js';

type State = 'idle' | 'dialing';
type Event = { type: 'DIAL' };
type Context = { attempts: number };

const createCall = () =>
  new Fsm<State, Event, Context>({
    name: 'call',
    initial: 'idle',
    context: { attempts: 0 },
    states: { idle: {}, dialing: {} },
    transitions: { idle: { DIAL: { target: 'dialing' } } },
  });
const call = createCall();

// The real sources fit the structural port.
const port: FsmSubscribable<FsmSnapshot<State, Context>> = call;
declare const hierarchy: FsmHierarchy<Event>;
const treePort: FsmSubscribable<HierarchySnapshot> = hierarchy;

// Hooks run inside a hook, as the rules of hooks require; this file is only typechecked.
export function useTypeContract(): void {
  const snapshot: FsmSnapshot<State, Context> = useFsmSnapshot(call);
  const state: State = useFsmSnapshot(call).value;
  const path: string = useFsmSelector(hierarchy, (s) => s.path);

  const byAttempts: EqualityFn<{ attempts: number }> = (a, b) =>
    a.attempts === b.attempts;
  const selected: { attempts: number } = useFsmSelector(
    call,
    (s) => ({ attempts: s.context.attempts }),
    byAttempts,
  );

  const options: UseFsmOptions<Fsm<State, Event, Context>> = {
    attach: (machine) => {
      machine.send({ type: 'DIAL' });
      return () => undefined;
    },
    teardown: () => undefined,
  };
  const owned = useFsm(createCall, options);
  const ownedMachine: Fsm<State, Event, Context> = owned.machine;
  const ownedSnapshot: SnapshotOf<typeof call> = owned.snapshot;
  const ownedState: State = owned.snapshot.value;
  useFsm(createCall, { attach: () => undefined });
  useFsm(createCall);

  void [port, treePort, snapshot, state, path, selected];
  void [ownedMachine, ownedSnapshot, ownedState];

  // @ts-expect-error A source needs `snapshot` and `subscribe`.
  useFsmSnapshot({ snapshot: 1 });
  // @ts-expect-error The selector receives the source's snapshot type.
  useFsmSelector(call, (s: { path: string }) => s.path);
  const sameNumber = (a: number, b: number) => a === b;
  // @ts-expect-error isEqual compares selections.
  useFsmSelector(call, (s) => s.value, sameNumber);
  // @ts-expect-error attach returns a cleanup or nothing.
  useFsm(createCall, { attach: () => 1 });
  // @ts-expect-error The returned result is read-only.
  owned.machine = call;
}
