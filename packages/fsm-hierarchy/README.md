# @bazariodev/fsm-hierarchy

Hierarchical composition layer for [`@bazariodev/fsm`](https://github.com/Bazariodev/bazario-labs/tree/main/packages/fsm). Orchestrates an active spine of flat machines with post-commit child reconciliation, deepest-first routing with bubbling, routed node handles, and composed snapshots.

Full design rationale: [`Hierarchy.md` ADR](https://github.com/Bazariodev/bazario-labs/blob/main/.agent/ADR/Modules/Hierarchy.md).

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
  states: {
    idle: {},
    connected: {},
    failed: {},
  },
  transitions: {
    idle: { CONNECT: { target: 'connected' } },
    connected: {},
    failed: {},
    '*': { HANGUP: { target: 'failed' } },
  },
  children: {
    connected: {
      name: 'connected-flow',
      initial: 'active',
      context: {},
      states: {
        active: {},
        muted: {},
      },
      transitions: {
        active: { MUTE: { target: 'muted' } },
        muted: { UNMUTE: { target: 'active' } },
        '*': {},
      },
    },
  },
});

call.send({ type: 'CONNECT' });
call.snapshot.path; // "connected.active"

call.send({ type: 'MUTE' });
call.matches('connected'); // true
call.snapshot.path; // "connected.muted"

call.send({ type: 'HANGUP' }); // bubbles to root
call.snapshot.path; // "failed"
```

## Design decisions

- **Composition, not core.** Every node is backed by a normal `Fsm`; the hierarchy owns routing, child lifecycle, and snapshot composition.
- **Post-commit reconciliation.** A routed handle calls the underlying node `send()`, compares the node version before/after, then reconciles children after a successful commit.
- **Active spine only.** v1 supports one child region per active state. No parallel regions, history, explicit cross-boundary targets, or root-priority events.
- **Innermost-first routing.** Events start at the active leaf. If that node cannot handle the event, routing bubbles upward until a node accepts it or the event is rejected.
- **Routed node handles.** `nodeFor(path)` and `onNodeSpawned` expose `FsmCore`-compatible handles. Effects/delays can attach to those handles and still send through hierarchy bubbling.
- **Affected notifications only.** Node-handle subscribers run only for the node that accepted the transition and nodes newly spawned by reconciliation; unchanged active ancestors are not notified.
- **Eager validation.** The full config tree is validated at construction, and only own `children` entries participate in reconciliation.
- **No sends during reconciliation.** `subscribe()` is allowed from `onNodeSpawned`, but synchronous `send()` through the hierarchy or any node handle is rejected until reconciliation finishes.

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
```

```ts
type HierarchyNode<TEvent extends FsmEvent> = Readonly<{
  path: string;
  handle: FsmCore<string, TEvent, unknown>;
}>;
```

`onNodeSpawned` receives a routed `handle`, not the raw internal `Fsm`. `nodeFor(path)` returns the same kind of routed handle for active paths and `undefined` for inactive, unknown, or disposed paths.

Routed handles intentionally differ from a raw `FsmCore` in three places: `send` bubbles from that node toward the root, disposed handles are inert, and subscribers registered during `onNodeSpawned` receive the spawned node's version-0 birth snapshot after reconciliation completes.

`stop()` disposes the active spine deepest-first, runs returned `onNodeSpawned` cleanups best-effort, marks handles inert, and clears subscribers.

## License

MIT
