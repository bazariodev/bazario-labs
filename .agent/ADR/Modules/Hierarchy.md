# ADR: FSM Hierarchy Module

- Status: Accepted
- Date: 2026-05-31
- Accepted: 2026-07-05

## Context

The base core (`@bazariodev/fsm`) is deliberately **flat**: one machine, one active state name, a single level of transitions (`Base/CoreFSM.md`). Hierarchical states are explicitly listed as out of scope there, to be "added later as separate modules built around the stable core," and the core names its only extension seams as constructor config, `subscribe()`, external orchestration around `send()`, and logger injection — **transition-resolution internals are not a seam**, and subclassing is discouraged in favor of composition.

Real UCaaS flows are naturally nested:

- `connected` is a sub-flow: `connected.active` ↔ `connected.onHold` ↔ `connected.muted`
- `reconnecting` has internal phases: `reconnecting.backoff` → `reconnecting.dialing`
- a top-level `failed`/`HANGUP` should catch events that the active inner state does not handle

Today you model this by hand-coding a second `Fsm` and wiring `subscribe`/`send` between the two, repeating lifecycle and routing glue at every nesting point. This module gives nested machines a first-class, declarative home.

## Decision

We will build hierarchy as a **composition layer that orchestrates a tree of flat `Fsm` instances** — the base core is not modified, and we do not reimplement transition resolution. A parent state may own a nested child machine; the runner reconciles child machines after successful parent commits, routes events to the deepest active node first (bubbling unhandled events up), and exposes a combined hierarchical snapshot.

Each node in the tree is a real `Fsm`, so:

- effects (`@bazariodev/fsm-effects`) and delays (`@bazariodev/fsm-delays`) attach to hierarchy-provided routed node handles
- the core's contract (lock, hooks, subscribe, error policy) holds at every level
- the module's job is **lifecycle + routing + snapshot composition**, nothing more

This is the "spawn child machine" primitive the effects ADR deferred, realized as orchestration rather than a new engine.

## Resolved decisions

These were open at drafting time and have been settled:

1. **Config shape: associated `children` map.** Each level is a plain `FsmConfig`; a `children` map associates a parent state with a child config (`children: { connected: connectedSubConfig }`). Every node stays an ordinary, independently-typed `Fsm`, so effects/delays compose through routed node handles and no parallel config language is invented. The accepted cost is looser cross-level type inference at the `children` boundary (see decision 6).
2. **Event routing: deepest-active-node first, bubbling up.** `send(e)` tries the deepest active node; if it cannot handle `e` (`node.can(e) === false`), it bubbles to the parent and repeats. The first node that can handle it wins; if none can, the event is rejected (no-op, optional debug log). A parent never pre-empts a child for the same event — strictly innermost-first. Top-level `*` `HANGUP`/`FAIL` transitions catch only events inner states ignore; v1 has no "root priority" event class.
3. **Re-entry: fresh, no history.** Re-entering a parent re-instantiates its child at the child's `initial`. Shallow/deep history is deferred.
4. **No parallel / orthogonal regions in v1.** One child region per state. Parallel regions are a separable follow-up.
5. **No explicit cross-boundary targets in v1.** A child cannot target an ancestor state directly; cross-level flow is modeled by leaving an event unhandled (or via a parent `*` transition) so the parent transitions and disposes the subtree.
6. **Typing: per-node strict, boundary loose.** Each node's own config is fully typed; the `children` boundary is typed loosely (e.g., `FsmConfig<string, FsmEvent, unknown>`), and the composed snapshot is typed structurally. Stricter path/snapshot typing is revisited once the runtime shape is proven.
7. **Context: separate, composed, static at spawn.** Each `Fsm` owns its context; the snapshot composes (does not merge) them. A child starts from its own config's `context`. Parent-derived child context initializers are out of scope for v1.
8. **Lifecycle seam: routed send + post-commit reconciliation.** Every exposed dispatch path is a hierarchy-owned handle. The handle calls the underlying node `Fsm.send`, compares the node snapshot version before/after, then reconciles children after a successful commit. The runner does not use core subscriber callbacks for internal correctness, so subscriber error containment in the core cannot hide hierarchy spawn failures. It does not attempt pre-commit child disposal or cross-node atomic transactions.

## Scope

### In scope for v1

- declarative nesting: a parent state owns one child machine (single region)
- post-commit spawn/dispose reconciliation for the child subtree, with fixed ordering
- deepest-first event routing with bubbling to ancestors
- a composed, recursive hierarchical snapshot with a dotted `path` and a `matches(path)` helper
- `subscribe` to composed snapshot changes; `stop()` / `[Symbol.dispose]` to tear down the whole tree
- access to each active node through a routed `FsmCore`-compatible handle so effects/delays can attach and send through hierarchy routing
- an `onNodeSpawned` lifecycle hook that may return cleanup; returned cleanup is called when that node is disposed or the hierarchy stops
- error and lifecycle reporting through the same `Logger` interface

### Out of scope for v1

- parallel / orthogonal regions
- shallow or deep history
- explicit cross-boundary transition targets (use bubbling)
- automatic context merging across levels
- parent-derived child context initialization
- persistence/rehydration of a running tree (composes with a future persistence module)
- more than one child region per state
- root-priority or externally prioritized events

## Model and contract (draft)

```ts
// A node: an ordinary FsmConfig, plus children keyed by this node's state names.
type HierarchyConfig<TState extends string, TEvent extends FsmEvent, TContext> =
  FsmConfig<TState, TEvent, TContext> & {
    children?: Partial<Record<TState, HierarchyConfig<string, FsmEvent, unknown>>>;
  };

type HierarchyNode<TEvent extends FsmEvent> = Readonly<{
  path: string;                  // dotted node path, e.g. "connected.muted"
  handle: FsmCore<string, TEvent, unknown>; // routed handle, not raw Fsm
}>;

type HierarchyNodeCleanup = () => void;

type HierarchyNodeSnapshot = Readonly<{
  value: string;                 // this node's flat value
  context: unknown;              // this node's context
  version: number;               // this node's version
  path: string;                  // dotted path to this node, e.g. "connected.muted"
  child: HierarchyNodeSnapshot | null;
}>;

// Composed tree snapshot.
type HierarchySnapshot = Readonly<{
  treeVersion: number;           // hierarchy-level version, increments per emitted composed snapshot
  path: string;                  // active leaf path, e.g. "connected.muted"
  root: HierarchyNodeSnapshot;
}>;
```

Rules (draft):

- the active **path** is `snapshot.path`
- each node snapshot's `path` is the dotted path from the root to that node
- `matches(path)` returns true when `path` is a whole-segment prefix of (or equal to) the active path — `matches('connected')` is true while in `connected.muted`, but not while in `connectedness`
- hierarchy configs reject state names containing `.` so dotted paths are unambiguous; `*` remains reserved by the core
- every own `children` key must be a declared state of its node; unknown keys fail fast at construction, inherited/prototype keys are ignored, and inactive child configs are validated eagerly without constructing their machines
- hierarchy validation also rejects empty/whitespace names at the loose composition boundary; this is intentionally stricter than the current flat core and prevents anonymous nodes in composed diagnostics
- a child is spawned only after its parent has committed entry into the owning state
- a child is disposed only after its parent has committed leaving the owning state

## Lifecycle and ordering (draft)

Entering a compound state `P` (with child region `C`, child initial `c0`):

1. parent accepts and commits `→ P` using the core's normal order (`onLeave`, reducer, `onEnter`, `onTransitionBeforeCommit`, commit, notify)
2. the hierarchy handle sees the parent's snapshot version changed, then spawns child `C` at `c0` (child constructor runs `onEnter(c0)`)
3. the runner continues reconciliation for descendants, recomputes the composed snapshot, increments `treeVersion`, then notifies affected live node-handle subscribers in active-spine order (`root → leaf`) and hierarchy subscribers last

Leaving `P`:

1. parent accepts and commits the leave using the core's normal order
2. the hierarchy handle sees the parent's snapshot version changed, then disposes now-inactive child subtree `C` deepest-first (descendants before ancestors)
3. for each disposed node, the runner invokes the cleanup returned from `onNodeSpawned`, if any
4. the runner spawns any newly-active child subtree, recomputes the composed snapshot, increments `treeVersion`, then notifies affected live node-handle subscribers in active-spine order (`root → leaf`) and hierarchy subscribers last

After **any** accepted node transition, the runner reconciles the active child tree against committed active states: dispose newly-left regions deepest-first, then spawn newly-entered regions outermost-first. Reconciliation is synchronous, mirroring the core's no-microtask model. A transition that changes only a node's `value`/`context` (no spawn or dispose) still recomputes the composed snapshot, bumps `treeVersion`, and notifies once. A rejected transition leaves the node version unchanged and causes no reconciliation or hierarchy notification.

On construction the runner builds the full **initial active spine** the same way: it constructs the root, then spawns the declared child of each node's `initial` state down to a leaf with no child, firing `onNodeSpawned` for each from root downward, before the first composed snapshot is available from `snapshot`.

Important consequence: parent lifecycle hooks run before hierarchy disposes or spawns children, because the core does not expose a pre-commit reconciliation seam. If a parent transition rejects, the existing child subtree remains intact. v1 accepts per-node transactionality rather than pretending the composed tree is cross-node atomic.

## Implementation shape for v1 (draft)

The runtime should be an **active spine**, not a general statechart tree engine. Because v1 allows only one child region per active state, the in-memory shape can be a linked chain:

```ts
type RuntimeNode = {
  path: string;
  machine: Fsm<string, FsmEvent, unknown>;
  handle: FsmCore<string, FsmEvent, unknown>;
  child: RuntimeNode | null;
  cleanup: (() => void) | null;
  disposed: boolean;
};
```

Keep the implementation split by the few real responsibilities, with dependencies wired in the `FsmHierarchy` constructor rather than exposed as public API:

- `FsmHierarchy` owns the public API, event bubbling, the reconciliation no-send gate, and the reconciliation loop.
- `NodeLifecycle` owns constructing/disposing `RuntimeNode`s and building routed node handles.
- `ActiveSpine` owns the root pointer, active path registry, spine/leaf traversal, `treeVersion`, and composed snapshot construction.
- `HierarchyNotifier` owns hierarchy subscribers and the fixed notification order.
- config validation stays as a small pure module.

Reconciliation walks that chain from the changed node downward:

1. dispose descendants that no longer match committed parent states
2. spawn the single declared child for the new committed state, if one exists
3. repeat until the active leaf has no declared child

Do not build generic region maps, transition target parsers, history stores, priority tables, or a statechart interpreter in v1. If parallel regions are added later, `child` can become a region map behind the same public snapshot/routing concepts.

Node-handle subscriptions are owned by the hierarchy runner, not delegated directly to the underlying `Fsm.subscribe`. They are delivered after hierarchy reconciliation, so effects attached to handles observe the already-reconciled active spine. When both node-handle and hierarchy subscribers are notified for the same committed transition, affected node-handle subscribers run first in active-spine order (`root → leaf`), then hierarchy subscribers run last. "Affected" means the node accepted the transition or was newly spawned by the reconciliation. Unchanged ancestors/descendants are not notified for that transition. The hierarchy snapshot and node snapshots are captured before notification starts, so a re-entrant send from a subscriber cannot rewrite the older notification payload. Disposed node handles are cleared before notification and receive no final callback. Subscriber errors are logged and contained, matching the core's subscriber policy.

## Composition with effects and delays

Because every node is backed by an `Fsm`, a consumer can attach `FsmEffects`/`FsmDelays` to a hierarchy-provided node handle. The handle implements the `FsmCore` surface for that node's local snapshot/subscription, but its `send` and `can` are routed through the hierarchy starting at that node and bubbling upward. This is what lets a child delay send an event that the child ignores and have the parent catch it.

The runner itself does not depend on effects/delays. The only ownership primitive in v1 is `onNodeSpawned`: if the callback returns a cleanup function, the runner stores it and invokes it on node disposal or `stop()`. Consumers that attach effects/delays through `nodeFor(path)` outside the spawn hook own their cleanup themselves. `onNodeSpawned` also fires for the root node during construction, so root-level effects attach the same way.

## Re-entrancy and handle lifetime

Routing and reconciliation are synchronous. v1 keeps re-entrancy small by making reconciliation a no-send zone:

- **No synchronous send during reconciliation.** While hierarchy reconciliation is running, any `send` through `hierarchy.send()` or any node handle throws `fsm-hierarchy: cannot send while reconciliation is in progress`, and `can` returns `false`. This covers both `onNodeSpawned` and a child initial `onEnter` during construction. It prevents a half-built child from mutating an ancestor before the outer reconciliation has linked the child.
- **Subscribe is still allowed during spawn.** While `onNodeSpawned` is running for a node, that node's handle accepts `subscribe()` because `FsmEffects` attaches that way; it registers normally and receives the node's version-0 birth snapshot after reconciliation completes. This is a hierarchy-handle delta from raw `FsmCore`, whose `subscribe()` has no replay.
- **Reconciliation is idempotent.** It makes the active spine match the current committed states. If a routed send happens from a later subscriber/effect, that send runs its own `raw send -> reconcile -> notify` cycle; when the outer work resumes it re-reads committed state and does nothing if the spine is already consistent.
- **A disposed node's handle is inert.** After disposal, `send` no-ops, `can` returns `false`, `snapshot` returns the last committed value, existing local subscribers are cleared, and `subscribe()` returns a no-op unsubscribe without registering anything. This matches the effects module's guarded-send behavior while preventing retained dead handles from doing work.

`send` **throws** while reconciling but **no-ops** while disposed on purpose: sending through a half-built spine is a programming error worth surfacing, whereas a retained handle firing after its node is gone (e.g. a late timer or cleanup) is expected and should be ignored, not raised.

Together these cover the tricky case: a child routed `send` bubbles up and the parent transition disposes that child subtree from a later effect/subscriber. The parent commits, the child's `onNodeSpawned` cleanup stops its effects, and the now-inert child handle ignores any further sends — no queue needed.

A node handle dispatches **from its own node upward and never into descendants**; `hierarchy.send` starts at the active leaf. For a handle on the active leaf the two are identical.

`stop()` disposes the current active spine deepest-first, using the same best-effort cleanup policy as reconciliation. It marks all handles inert, clears node-handle and hierarchy subscribers, and is idempotent. If `stop()` is called from a cleanup while reconciliation is in progress, the runner aborts the remaining reconciliation and does not spawn replacement children. It does not emit a final hierarchy snapshot.

## Error policy (draft)

- per-node behavior is the core's: guard/reducer/hook throws are transactional and rethrow from that node's `send`
- routing surfaces a node error to the original `send` caller; the runner does not swallow it
- cleanup returned from `onNodeSpawned` is best-effort: cleanup throws are logged and contained so other node cleanups continue
- **node construction failure is fatal.** If a child's own setup throws during spawn — a child initial `onEnter`, or config rejected by core validation — the node is structurally broken. The error is logged, the active hierarchy tree is stopped, and the same error is rethrown from the `FsmHierarchy.send` / node-handle `send` call that triggered reconciliation (or from the constructor, during construction). The runner does not continue with a missing required child.
- **`onNodeSpawned` callback failure is an attachment failure, not a node failure.** If the callback itself throws (including the reconciliation-guard `send` rejection surfacing through it), the node has already spawned and is healthy; only the consumer's attachment failed. The runner logs and contains it, leaves the node active, and continues — it does not stop the tree. (The common case — attaching `FsmEffects` whose initial effect synchronously sends — is already contained inside the effects runner, so nothing reaches the runner here.)

## Public API (draft)

```ts
class FsmHierarchy<TEvent extends FsmEvent> {
  constructor(
    config: AnyHierarchyConfig<TEvent>,
    options?: {
      logger?: Logger;
      onNodeSpawned?: (node: HierarchyNode<TEvent>) => void | HierarchyNodeCleanup;
    },
  );

  readonly snapshot: HierarchySnapshot;
  send(event: TEvent): void;
  matches(path: string): boolean;
  subscribe(listener: (snapshot: HierarchySnapshot) => void): Unsubscribe;
  can(event: TEvent): boolean;
  nodeFor(path: string): FsmCore<string, TEvent, unknown> | undefined;
  stop(): void;
  [Symbol.dispose](): void;
}
```

`can(e)` mirrors `send` resolution: it returns true if any node on the bubble path (active leaf upward) can handle `e`. Because core `can()` evaluates guards and `send()` evaluates them again, routing may evaluate pure guards more than once. This is acceptable because guards are already required to be synchronous and side-effect free by the core contract.

`nodeFor(path)` returns the live routed handle for an active node path. It returns `undefined` for unknown paths, inactive paths, and disposed nodes. During `onNodeSpawned`, `nodeFor(path)` returns the live handle; `subscribe()` is allowed, while `send()` and `can()` are governed by the reconciliation no-send gate above.

`FsmHierarchy` does **not** implement `FsmCore` (its snapshot is recursive, not the flat `FsmSnapshot`), so effects/delays attach to individual routed node handles via `nodeFor(...)` or `onNodeSpawned`, not to the hierarchy as a whole.

## Packaging

- new package `@bazariodev/fsm-hierarchy`, peer dependency on `@bazariodev/fsm` (current major)
- effects/delays are **not** peer deps — composition is opt-in by the consumer
- same tooling (tsup, vitest, Biome), own README + LICENSE, own changeset cadence

## Composition vs in-core

The CoreFSM ADR forbids using transition-resolution internals as a seam and prefers composition over subclassing. A composed tree of flat machines honors that: the core stays flat and unchanged, each level remains independently testable, and hierarchy ships and versions on its own. The cost is that some full-statechart semantics (cross-boundary targets, parallel regions, history) are deferred or modeled indirectly via bubbling — accepted for v1.

## Consequences

Positive:

- the base core stays flat and untouched
- every node is backed by a real `Fsm`, so effects/delays and the core contract compose through routed handles
- nesting becomes declarative instead of hand-wired `subscribe`/`send` glue
- the runner is testable against stub child configs

Tradeoffs:

- routing and tree reconciliation are new, non-trivial runtime logic, kept behind small internal collaborators
- heterogeneous-tree typing is looser at the `children` boundary
- deferring parallel regions, history, and cross-boundary targets means some statecharts can't be expressed directly in v1
- the composed tree is not cross-node atomic; child reconciliation happens after parent commits
- consumers either attach effects/delays in `onNodeSpawned` and let the runner call returned cleanup, or they manage cleanup themselves

## Next steps

1. Scaffold `packages/fsm-hierarchy/` (package.json with peer dep on `@bazariodev/fsm`, tsconfig, tsup, vitest, README, LICENSE).
2. Define types (`HierarchyConfig`, `HierarchySnapshot`, `HierarchyNodeSnapshot`, `HierarchyNode`) and the tree/reconciliation model.
3. Implement post-commit reconciliation, routed node handles, deepest-first routing with bubbling, composed snapshot, `subscribe`, `matches`, `can`, `stop`.
4. Tests: post-commit spawn/dispose ordering, innermost-first routing + bubbling, top-level `*` fallback catch, re-entry resets child, segment-aware `matches`/path validation, unknown `children` key rejected, routed node handles + effect attach/teardown through `onNodeSpawned`, synchronous send during reconciliation rejected while subscribe during `onNodeSpawned` is allowed, child initial `onEnter` cannot send during reconciliation, nested routed `send` after spawn (child send bubbles up and disposes its own subtree), `nodeFor(path)` active/inactive/onNodeSpawned semantics, inert handle after disposal, node-handle subscribers notified after reconciliation in `root → leaf` order before hierarchy subscribers, non-structural transition still emits + bumps `treeVersion`, cleanup error containment, spawn fail-fast rethrows from triggering send, `stop()` deepest-first disposal.
5. First changeset for `@bazariodev/fsm-hierarchy` at `0.1.0`.

## Summary

A composition layer that orchestrates a tree of flat `@bazariodev/fsm` instances into a hierarchical machine: post-commit child reconciliation, deepest-first event routing with bubbling, routed node handles, and a composed recursive snapshot — without modifying the core. v1 targets single nested regions, fresh re-entry, and bubbling-based cross-level flow; parallel regions, history, root-priority events, parent-derived child context, and explicit cross-boundary targets are deferred. The load-bearing decisions are resolved; implementation can begin.
