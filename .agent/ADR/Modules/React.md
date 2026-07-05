# ADR: FSM React Bindings Module

- Status: Accepted
- Date: 2026-07-05
- Accepted: 2026-07-05

## Context

The workspace positions its packages for frontend runtimes, and the roadmap's R1 names React bindings as the last non-stretch item before the FSM family freezes at 1.0 (`ROADMAP.md`). Today a React consumer hand-wires machines into components:

- `useEffect` + `subscribe()` + `useState` re-render glue, re-written per component
- no tearing safety under concurrent rendering
- selector/derived-slice subscriptions re-implemented ad hoc, usually re-rendering on every commit
- machine and runner lifetime (construct, attach `FsmEffects`/`FsmDelays`/`FsmHierarchy`, stop on unmount) colliding with StrictMode's simulated double-mount

All four shipped packages expose the same observation seam — a stable `snapshot` accessor plus `subscribe(listener): Unsubscribe` with post-commit notification (`Base/CoreFSM.md` §2, §8; `Modules/Hierarchy.md` public API). That uniformity is what a bindings package can lean on.

## Decision

We will build `@bazariodev/fsm-react` as a thin binding layer over the public `snapshot`/`subscribe` seams, implemented on React's `useSyncExternalStore`. The package binds to a **structural source port**, not to a concrete class:

```ts
type FsmSubscribable<TSnapshot> = Readonly<{
  snapshot: TSnapshot;
  subscribe: (listener: () => void) => Unsubscribe;
}>;
```

`Fsm`, `FsmHierarchy`, and hierarchy node handles all satisfy this shape today without modification, and every future domain module that follows the workspace observation idiom (`transport-ws`, `call`, …) binds for free. The port — not `FsmCore` — is the UI-binding contract.

v1 ships three hooks: `useFsmSnapshot` (subscribe), `useFsmSelector` (derived slice with equality bail-out), and `useFsm` (component-owned machine with StrictMode-safe attach/teardown lifecycle). No core or sibling package changes.

## Resolved decisions

These were open at drafting time and have been settled:

1. **React floor: 18.** Peer range `^18.0.0 || ^19.0.0`. `useSyncExternalStore` is built in from 18, so the `use-sync-external-store` legacy shim is not a dependency. React 17 support is a non-goal (aligned with the ES2022 / modern-runtime stance).
2. **Structural port over `FsmCore` coupling.** Hooks accept `FsmSubscribable<TSnapshot>`: a stable `snapshot` accessor plus `subscribe(listener)` where the listener is a zero-argument change signal. `@bazariodev/fsm` remains a peer for shared types (`Unsubscribe`, `FsmSnapshot`) but is never imported at runtime — the package has zero runtime imports besides React.
3. **Selector support is implemented internally.** The with-selector algorithm — cache the last `(snapshot, selector, isEqual, selection)` entry; recompute when the snapshot reference **or** the `selector`/`isEqual` identity changes; preserve the previous selection reference when `isEqual` passes — is small enough that taking `use-sync-external-store/with-selector` as a dependency is not worth the coupling. Default equality is `Object.is`.
4. **The owning hook ships in v1, with explicit lifecycle and a discard-safety requirement on `create`.** `useFsm(create, { attach, teardown })` owns instance creation and StrictMode-correct attachment. There is no auto-detection magic (no "call `.stop()` if present"); stopping runners is the consumer's explicit `teardown`/attach-cleanup, mirroring the `onNodeSpawned` cleanup idiom from the hierarchy module. Because StrictMode double-invokes state initializers, `create` may run twice with one result discarded un-torn-down — so `useFsm` requires constructor-run hooks (initial `onEnter`, construction-time `onNodeSpawned`) to stay registration-only and resource-free; resource acquisition belongs in `attach`. The re-creation-after-teardown behavior is specified as a normative algorithm in "Ownership lifecycle", not left to implementation choice.
5. **SSR: render-only.** `getServerSnapshot` returns the same `source.snapshot`, so server rendering works for initial markup. Server/client initial-state consistency is the consumer's responsibility. Built outputs carry a `'use client'` banner so the package can be imported from RSC codebases without ceremony.
6. **No provider/context layer in v1.** Machines arrive as props, module singletons, or `useFsm` locals. A context helper is trivial userland (`createContext<Fsm…>`), and shipping one would push an app-architecture opinion the SDK does not need to hold.

## Scope

### In scope for v1

- `FsmSubscribable<TSnapshot>` structural port type
- `useFsmSnapshot(source)` — tearing-safe reactive snapshot
- `useFsmSelector(source, selector, isEqual?)` — derived slice, re-render only on selected change
- `useFsm(create, options?)` — component-owned machine: lazy one-time creation, effect-scoped `attach` with cleanup, `teardown`, StrictMode-safe re-creation semantics
- SSR support via `getServerSnapshot`; `'use client'` banner in dist
- source identity changes (prop-swapped machine) resubscribe correctly

### Out of scope for v1

- context provider / dependency-injection helpers
- Suspense integration, `use()` reading, transition/scheduling opinions (`startTransition`, `useDeferredValue` stay userland; README shows the pattern)
- devtools / inspector integration (future `fsm-inspect`)
- server-side machine execution or serialization (future `fsm-persist` composes here)
- bindings for other frameworks (separate packages if demand appears)
- convenience wrappers like `useFsmMatches(hierarchy, path)` — expressible as one-line selectors

## Hook contracts

```ts
type EqualityFn<T> = (a: T, b: T) => boolean;

function useFsmSnapshot<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
): TSnapshot;

function useFsmSelector<TSnapshot, TSelected>(
  source: FsmSubscribable<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  isEqual?: EqualityFn<TSelected>, // default Object.is
): TSelected;

type UseFsmOptions<TMachine> = Readonly<{
  attach?: (machine: TMachine) => void | (() => void);
  teardown?: (machine: TMachine) => void;
}>;

type SnapshotOf<TMachine> = TMachine extends FsmSubscribable<infer S>
  ? S
  : never;

function useFsm<TMachine extends FsmSubscribable<unknown>>(
  create: () => TMachine,
  options?: UseFsmOptions<TMachine>,
): Readonly<{ machine: TMachine; snapshot: SnapshotOf<TMachine> }>;
```

Rules:

- all three hooks are client-only; they rely on `useSyncExternalStore` and effects
- `useFsmSnapshot` re-renders only on committed transitions — rejected events never notify (core §8), so bail-out is free
- sources must uphold the workspace snapshot-stability rule: the `snapshot` accessor returns the **same reference** between commits (`Base/CoreFSM.md` §2; the hierarchy's composed snapshot behaves the same). A source that allocates per read would loop `useSyncExternalStore`; this is a documented contract of the port, not something the hooks defend against at runtime
- `selector` must be pure and side-effect free; it runs during render and on store change. When `isEqual` passes, the previous selection reference is returned, so memoized children see stable props
- inline `selector`/`isEqual` lambdas are fine: latest-ref handling means changing their identity does not resubscribe; only `source` identity changes resubscribe
- **selector identity changes invalidate the selection cache.** The internal cache is keyed on the `(snapshot, selector, isEqual)` triple, not on snapshot reference alone: swapping the selector between renders (e.g. a prop switches `s => s.a` to `s => s.b`) must recompute against the current snapshot even though no transition occurred. Returning the previous selector's cached output is a spec violation and has a required test
- selecting into `context` reads shallow-frozen data (core §2): nested mutation is invisible to equality checks by design — derive primitives or copies in reducers instead
- `Fsm.send` and `FsmHierarchy.send` are prototype methods that touch private fields — call them on the instance (`machine.send(e)`) or wrap them in a handler; a detached method reference throws. Only hierarchy node handles are detach-safe (closure-based methods). The README documents the asymmetry
- hook internals never hand a detached method to React either: `subscribe` and `getSnapshot` passed to `useSyncExternalStore` are always closures over the source — `(onChange) => source.subscribe(onChange)` and `() => source.snapshot` — never `source.subscribe` itself, so class-based sources with private fields work unconditionally
- sending during render is forbidden (React side-effect rule); send from event handlers or `attach`-installed effects

## Ownership lifecycle (`useFsm`)

The hook must be correct under StrictMode's dev probes, which are exactly where hand-rolled machine ownership breaks. Two React behaviors drive this design, stated explicitly so the implementation and tests target the real model rather than a folk model of "simulated remount":

- StrictMode double-invokes render-phase functions **including `useState` initializers**: `create` can run twice for one retained instance, and the discarded twin is never torn down.
- StrictMode replays effects as **setup → cleanup → setup on the same component instance**. State is never reset and initializers do not re-run. Any re-creation after teardown is this hook's own doing, driven by its own state — React provides no remount to lean on.

Rules:

- **`create` must be discard-safe.** Constructing a workspace machine is observable behavior: `Fsm` runs the initial state's `onEnter` during construction (`Base/CoreFSM.md`, initialization behavior) and `FsmHierarchy` fires `onNodeSpawned` for the whole initial spine before any `attach` exists (`Modules/Hierarchy.md`). `useFsm` therefore requires that constructor-run hooks in configs passed through `create` stay registration-only and resource-free; acquiring anything external (runners, sockets, timers) belongs in `attach`. Under that rule, a discarded twin from a double-invoked initializer costs nothing.
- `create` runs in the lazy `useState` initializer — render-phase, possibly twice in dev, once in prod; never once-per-render.
- `attach` runs in a passive effect after mount; its returned cleanup runs on unmount and on the StrictMode probe's cleanup phase. `FsmEffects` / `FsmDelays` / hierarchy runners belong here, and stopping them is the returned cleanup — the same registration-returns-cleanup idiom as `onNodeSpawned`.
- `teardown` runs after `attach`'s cleanup, **in a `finally`**: a throwing cleanup must not skip `teardown`, and the dead flag is set unconditionally even when the cleanup or `teardown` itself throws — the dead-generation guarantee never half-applies. Errors still propagate to React rather than being swallowed; when both throw, the `teardown` error wins per JavaScript try/finally semantics. A machine is dead once `teardown` has run (a stopped hierarchy's `subscribe` hands back a no-op unsubscribe), and the hook must never attach to a dead machine.
- **Re-creation algorithm (normative).** The machine lives in a state cell alongside a dead flag that the teardown-running cleanup sets. On effect setup: if the cell's machine is dead, the setup does **not** call `attach`; it schedules a replacement — `setState` with a fresh `create()` result — and returns. The resulting re-render commits the fresh machine, the effect runs again, and `attach` targets only the fresh instance. `attach` is thus never invoked with a torn-down machine, and the subscription hooks re-read the fresh snapshot in the same pass.
- Without `teardown`, the instance survives the probe untouched and `attach` simply runs again against it — no re-creation, no reset.
- The dead-generation render happens before the replacement commits, so `snapshot` must stay readable on dead sources. Both shipped sources satisfy this: the core has no stop, and a stopped hierarchy retains its last composed snapshot.
- `attach`/`teardown` are read through latest-refs at effect time; changing their identity between renders does not restart the lifecycle.
- Consequence to document loudly in the README: with `teardown`, StrictMode dev shows a brief reset to the machine's initial state after the probe (fresh instance). This is dev-only and is the price of honest teardown; machines that must not reset belong outside component ownership (module scope or a parent), consumed via the subscription hooks.
- machines that own resources transitively (an `FsmHierarchy`, a future transport) pass `teardown: (m) => m.stop()` explicitly — decision 4, no auto-detection

## SSR and RSC

- `getServerSnapshot` returns `source.snapshot` — the machine constructed for the request renders its initial (or pre-advanced) state as markup
- hydration consistency (same machine state on server and first client render) is the consumer's responsibility; the README shows the "construct per request / construct in `useFsm`" split
- dist files carry a `'use client'` banner (tsup `banner` option) so importing from an RSC module graph marks the boundary correctly; the package itself has no server entry

## Error policy

The hooks add no containment layer — React owns the component tree's error semantics:

- a throw from `selector`, `create`, `attach`, an attach cleanup, or `teardown` propagates; the hooks never swallow or log. Cleanup-versus-`teardown` ordering under errors is fixed in "Ownership lifecycle": `teardown` runs in a `finally` and the dead flag is set regardless
- machine errors surfaced through `send` (guards, reducers, hooks — core error policy) propagate at the call site (event handler or effect), untouched
- no `Logger` injection in v1: there is no construction seam that warrants it, and silent containment inside render would hide real bugs

## Validation

None at runtime. The port is a typed parameter; TypeScript enforces shape at the call site, and a pure-JavaScript caller passing a malformed source gets a natural `TypeError` from the first property access. This matches the effects/delays stance of leaning on types rather than adding runtime surface.

## Public API

Module exports:

- `useFsmSnapshot`, `useFsmSelector`, `useFsm` (functions)
- `FsmSubscribable`, `EqualityFn`, `UseFsmOptions`, `SnapshotOf` (types)

## Packaging

- new package `@bazariodev/fsm-react` in the workspace
- peer dependencies: `react` (`^18.0.0 || ^19.0.0`) and `@bazariodev/fsm` (current major, types only — no runtime import)
- `@bazariodev/fsm-effects` / `fsm-delays` / `fsm-hierarchy` are **not** peers; they meet this package only inside consumer `attach` callbacks
- same tooling (tsup, vitest, Biome), own README + LICENSE, own changeset cadence, `internal/messages.ts` + `internal/predicates.ts` per workspace convention where applicable
- divergences from sibling configs, both deliberate: vitest runs with a DOM environment (`jsdom`) and `@testing-library/react` as dev dependencies; tsup adds the `'use client'` banner
- `sideEffects: false` is preserved — the banner is a directive, not a side effect

## Composition vs in-core

The bindings consume only public seams (`snapshot`, `subscribe`), the same rule every module has followed since `fsm-effects`. Choosing the structural port over `FsmCore`:

- hierarchy (whose recursive snapshot deliberately does not implement `FsmCore`) binds with the same two hooks — no special-cased `useHierarchy`
- every roadmap domain module that exposes the workspace observation idiom becomes React-consumable with zero binding work — this package is the UI contract for the whole platform, not just the FSM family

Alternatives considered:

- **hand-rolled `useEffect` + `useState` subscription** — rejected: not tearing-safe under concurrent rendering; `useSyncExternalStore` exists precisely for external stores
- **depending on `use-sync-external-store/with-selector`** — rejected: pulls a runtime dependency to support React 17 (out of scope) and to save ~40 well-understood lines
- **auto-stopping machines that expose `stop()`** — rejected: implicit ownership magic; explicit `teardown` keeps lifetime visible at the call site, consistent with the "explicit responsibility" stance the effects ADR takes on leaked runners

## Consequences

Positive:

- one canonical, tearing-safe way to put any workspace machine on screen
- selector hook makes "re-render only on the slice you read" the default, not an optimization
- StrictMode-correct ownership is solved once, in the SDK, instead of wrongly in every app
- the structural port quietly standardizes the observation contract for all future domain modules

Tradeoffs:

- a DOM test environment and React dev dependencies enter the workspace (first package to need them)
- the snapshot-stability contract becomes load-bearing for third-party sources; a violating source misbehaves at runtime with no guardrail
- `useFsm`'s re-create-after-teardown semantics are subtle and must be documented prominently (dev-only in practice, but surprising when first seen)
- the discard-safety rule constrains which configs are eligible for `useFsm`: constructor-run hooks that acquire resources disqualify a machine from component ownership, and nothing can enforce that at runtime — it is a documented contract, like snapshot stability
- supporting two React majors widens the CI/test matrix by one dimension

## Next steps

1. Scaffold `packages/fsm-react/` (package.json with peers `react` + `@bazariodev/fsm`, tsconfig, tsup with `'use client'` banner, vitest with jsdom, README, LICENSE).
2. Define types: `FsmSubscribable`, `EqualityFn`, `UseFsmOptions`, `SnapshotOf`.
3. Implement `useFsmSnapshot`, then the internal with-selector cache and `useFsmSelector`, then `useFsm` (lazy init + generation lifecycle).
4. Tests: re-render on committed transition; no re-render on rejected event; selector bail-out preserves selection reference and skips re-render; selector recompute on snapshot change; **selector identity swap without any transition recomputes from the current snapshot (no stale cache)**; inline selector/isEqual identity churn does not resubscribe; source swap resubscribes and reads the new snapshot synchronously; `Fsm` and `FsmHierarchy` as sources work through wrapped `subscribe`/`getSnapshot` closures (prototype methods with private fields are never detached); hierarchy node handle as source; SSR `renderToString` renders the initial snapshot; StrictMode without `teardown` keeps the instance and re-runs `attach` (cleanup interleaved); StrictMode with `teardown`: the dead-generation setup skips `attach`, a fresh machine is created and only it gets attached (count `create`/`attach` invocations, assert `attach` never receives a stopped machine); StrictMode double-invoked initializer: discarded twin is observable only as an extra `create` call, retained instance is the one rendered and attached; unmount order is attach-cleanup then `teardown`; **a throwing attach cleanup still runs `teardown` and sets the dead flag (error propagates, and a subsequent StrictMode setup re-creates instead of reattaching)**; send from an `attach`-installed effect updates the rendered snapshot.
5. First changeset for `@bazariodev/fsm-react` at `0.1.0`.

## Summary

`@bazariodev/fsm-react` binds workspace machines to React through a structural `FsmSubscribable` port on top of `useSyncExternalStore`: `useFsmSnapshot` for whole snapshots, `useFsmSelector` for equality-bailed slices, and `useFsm` for component-owned machines with explicit, StrictMode-correct `attach`/`teardown` lifecycle. React 18+ only, no runtime dependencies, SSR-renderable, `'use client'`-bannered, and deliberately free of provider/context and scheduling opinions. The port doubles as the UI observation contract for every future domain module.
