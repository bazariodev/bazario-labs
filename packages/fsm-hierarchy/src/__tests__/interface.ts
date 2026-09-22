import type { FsmCore, FsmSubscribable } from '@bazariodev/fsm';
import {
  type AnyHierarchyConfig,
  FsmHierarchy,
  type FsmHierarchyOptions,
  type HierarchyConfig,
  type HierarchyNode,
  type HierarchyNodeSnapshot,
  type HierarchySnapshot,
  type Unsubscribe,
} from '../index.js';

type Event = { type: 'CONNECT' } | { type: 'MUTE' } | { type: 'HANGUP' };

const media: HierarchyConfig<'active' | 'muted', Event, { mutes: number }> = {
  name: 'media',
  initial: 'active',
  context: { mutes: 0 },
  states: { active: {}, muted: {} },
  transitions: {
    active: {
      MUTE: {
        target: 'muted',
        reducer: (context) => ({ mutes: context.mutes + 1 }),
      },
    },
  },
};

const call: HierarchyConfig<'idle' | 'connected', Event, object> = {
  name: 'call',
  initial: 'idle',
  context: {},
  states: { idle: {}, connected: {} },
  transitions: {
    idle: { CONNECT: { target: 'connected' } },
    '*': { HANGUP: { target: 'idle' } },
  },
  children: { connected: media },
};

const options: FsmHierarchyOptions<Event> = {
  onNodeSpawned: ({ path, handle }: HierarchyNode<Event>) => {
    const text: string = path;
    const state: string = handle.state;
    void [text, state];
    return () => undefined;
  },
};

const hierarchy = new FsmHierarchy<Event>(call, options);
const loose: AnyHierarchyConfig<Event> = call;
void loose;

hierarchy.send({ type: 'CONNECT' });
const allowed: boolean = hierarchy.can({ type: 'MUTE' });
const inConnected: boolean = hierarchy.matches('connected');
const snapshot: HierarchySnapshot = hierarchy.snapshot;
const root: HierarchyNodeSnapshot = snapshot.root;
const version: number = snapshot.treeVersion;
const source: FsmSubscribable<HierarchySnapshot> = hierarchy;
const unsubscribe: Unsubscribe = hierarchy.subscribe((next) => {
  const path: string = next.path;
  void path;
});
unsubscribe();
const node: FsmCore<string, Event, unknown> | undefined =
  hierarchy.nodeFor('connected.active');
node?.send({ type: 'MUTE' });
hierarchy.stop();
hierarchy[Symbol.dispose]();
void [allowed, inConnected, root, version, source];

// @ts-expect-error Events must be members of the event union.
hierarchy.send({ type: 'UNKNOWN' });

const badChildKey: HierarchyConfig<'idle' | 'connected', Event, object> = {
  ...call,
  // @ts-expect-error Child keys must be declared states.
  children: { missing: media },
};
void badChildKey;

// @ts-expect-error The composed snapshot is read-only.
hierarchy.snapshot.treeVersion = 1;
