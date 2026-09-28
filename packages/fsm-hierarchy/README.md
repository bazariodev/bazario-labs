# @bazariodev/fsm-hierarchy

Nested state machines built from ordinary [`@bazariodev/fsm`](https://www.npmjs.com/package/@bazariodev/fsm)
machines. A state can own a child machine. Events go to the deepest active machine first and bubble
up through its parents until one handles them.

## Install

```sh
pnpm add @bazariodev/fsm-hierarchy @bazariodev/fsm
```

`@bazariodev/fsm` is a peer dependency.

## Usage

```ts
import { FsmHierarchy } from '@bazariodev/fsm-hierarchy';

const call = new FsmHierarchy({
  name: 'call',
  initial: 'idle',
  context: {},
  states: { idle: {}, connected: {}, failed: {} },
  transitions: {
    idle: { CONNECT: { target: 'connected' } },
    '*': { HANGUP: { target: 'failed' } },
  },
  children: {
    // `connected` owns a child machine
    connected: {
      name: 'connected-flow',
      initial: 'active',
      context: {},
      states: { active: {}, muted: {} },
      transitions: {
        active: { MUTE: { target: 'muted' } },
        muted: { UNMUTE: { target: 'active' } },
      },
    },
  },
});

call.send({ type: 'CONNECT' });
call.snapshot.path; // "connected.active"

call.send({ type: 'MUTE' }); // handled by the child
call.snapshot.path; // "connected.muted"
call.matches('connected'); // true

call.send({ type: 'HANGUP' }); // the child can't handle it, so it bubbles to the root
call.snapshot.path; // "failed"
```

## Behavior

- Each state has at most one child machine. There are no parallel regions, no history, and no
  transitions that target a state in another machine; cross-level flow works through bubbling.
- Entering a state creates its child machine fresh, at its `initial` state with its configured
  `context`. Leaving the state disposes the child. A self-transition keeps the child as it is.
- An event goes to the deepest active machine. If that machine can't handle it, the event bubbles to
  the parent, and so on up to the root. If no machine handles it, it's rejected and logged at `debug`.
- After a machine commits a transition, children are disposed and created to match the new states,
  then subscribers are notified.
- Subscribers never receive an older snapshot after a newer one, the same rule as core `Fsm`.
- The whole config tree is validated at construction, so a bad child config throws immediately
  instead of when its state is first entered. State names can't be empty or contain `.`, and `*` is
  reserved.
- While child machines are being created or disposed, `send()` throws and `can()` returns `false`.
  `subscribe()` still works.

## Snapshot

```ts
type HierarchySnapshot = {
  treeVersion: number; // increases on every committed transition anywhere in the tree
  path: string; // active states joined by ".", e.g. "connected.muted"
  root: HierarchyNodeSnapshot;
};

type HierarchyNodeSnapshot = {
  value: string; // this machine's state
  context: unknown;
  version: number; // this machine's own version
  path: string; // active path down to this machine, e.g. "connected.muted"
  child: HierarchyNodeSnapshot | null;
};
```

Snapshots are frozen. `call.snapshot` returns the same object until the next commit.

## Effects, delays, and node handles

`FsmHierarchy` isn't an `FsmCore`, so don't pass it to `FsmEffects` or `FsmDelays`. Attach them to
a node handle in `onNodeSpawned`, which runs each time a machine is created, including the root at
construction. Return a cleanup; it runs when that machine is disposed or the hierarchy stops:

```ts
import { FsmDelays } from '@bazariodev/fsm-delays';

// `callConfig` is the config from the usage example.
const call = new FsmHierarchy(callConfig, {
  onNodeSpawned: ({ handle }) => {
    if (handle.name !== 'connected-flow') return;
    const delays = new FsmDelays(handle, {
      delays: { muted: { after: 60_000, send: { type: 'UNMUTE' } } },
    });
    return () => delays.stop();
  },
});
```

- A handle's `send` starts at its machine and bubbles up like `call.send`. After its machine is
  disposed, the handle ignores `send` and keeps its last snapshot.
- Match nodes by `handle.name` (the config's `name`), not by path. A node's path ends at its
  *current* state, so it changes as the machine moves. In the usage example, once the call is in
  `connected.active`, `nodeFor('connected')` returns the root machine and
  `nodeFor('connected.active')` the child. After `MUTE`, only `nodeFor('connected.muted')` finds the
  child.
- An effect that sends synchronously while its machine is being created is rejected, because
  `send()` throws during that phase; FSM Effects logs it as `fsm-effects: effect threw`. Send from a
  timer or after an `await` instead.
- A handle's subscribers are notified once for each transition its own machine commits. As with
  `Fsm.subscribe`, subscribing doesn't deliver the current snapshot: read `handle.snapshot` for the
  starting state.

## API

```ts
class FsmHierarchy<TEvent extends FsmEvent> {
  constructor(
    config: AnyHierarchyConfig<TEvent>,
    options?: {
      logger?: Logger;
      onNodeSpawned?: (node: HierarchyNode<TEvent>) => void | (() => void);
    },
  );

  readonly snapshot: HierarchySnapshot;
  send(event: TEvent): void;
  can(event: TEvent): boolean;
  matches(path: string): boolean;
  subscribe(listener: (snapshot: HierarchySnapshot) => void): Unsubscribe;
  nodeFor(path: string): FsmCore<string, TEvent, unknown> | undefined;
  stop(): void;
  [Symbol.dispose](): void;
}

type HierarchyNode<TEvent extends FsmEvent> = Readonly<{
  path: string;
  handle: FsmCore<string, TEvent, unknown>;
}>;
```

- `can(event)` is `true` if any machine from the deepest one up to the root would accept `event`.
- `matches(path)` compares whole path segments: `matches('connected')` is true for `connected` and
  `connected.muted`, never for `connectedX`.
- `nodeFor(path)` returns the handle of the active machine at `path`, or `undefined`.
- `logger` is used by every machine whose config has no `logger` of its own. If `onNodeSpawned`
  throws, the error is logged and the machine stays active.
- `stop()` disposes every machine, deepest first, runs the `onNodeSpawned` cleanups (errors are
  logged), makes handles inert, and clears subscribers. Idempotent.

Use `HierarchyConfig<TState, TEvent, TContext>` to type each machine's config:

```ts
import type { HierarchyConfig } from '@bazariodev/fsm-hierarchy';

type CallEvent = { type: 'CONNECT' } | { type: 'MUTE' } | { type: 'UNMUTE' } | { type: 'HANGUP' };

const connectedFlow: HierarchyConfig<'active' | 'muted', CallEvent, { mutes: number }> = {
  name: 'connected-flow',
  initial: 'active',
  context: { mutes: 0 },
  states: { active: {}, muted: {} },
  transitions: {
    active: { MUTE: { target: 'muted', reducer: (context) => ({ mutes: context.mutes + 1 }) } },
    muted: { UNMUTE: { target: 'active' } },
  },
};
```

Other exported types: `AnyHierarchyConfig`, `HierarchyNode`, `HierarchyNodeCleanup`,
`HierarchySnapshot`, `HierarchyNodeSnapshot`, `HierarchySubscriber`, `FsmHierarchyOptions`, and
`Unsubscribe`.

## Upgrading to 2.0

In 1.x, when a transition created a child machine, the handle subscribers added in `onNodeSpawned`
received its first snapshot (`version` 0). In 2.0 they don't: a handle notifies only when its own
machine commits a transition. If you relied on that call, read `handle.snapshot` when you
subscribe. FSM Effects, FSM Delays, FSM Persist, FSM Inspect, and FSM React already work this way
and need no changes.

## License

MIT
