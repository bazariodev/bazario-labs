# @bazariodev/fsm-react

## 1.1.1

### Patch Changes

- Rewrite the package README so it stands on its own: install steps with peer dependencies, a minimal
  example first, behavior as short rules, and option tables. Document behavior that was missing, such
  as effect ordering, hierarchy child re-creation and node paths, persistence options and restore
  order, and inspection entry types. Link related packages to their npm pages. Include `CHANGELOG.md`
  in the published package. In FSM Delays, correct the `Resolvable` doc comment. These documentation
  and packaging changes don't change runtime behavior or types.

## 1.1.0

### Minor Changes

- Simplify the React bindings and move their implementation to plain JavaScript with a hand-written
  public `index.d.ts`, shipped as matching ESM `.d.ts` and CommonJS `.d.cts` declarations. Export
  names and hook signatures are unchanged.

  - `useFsmSnapshot` is `useFsmSelector` with an identity selector, so both hooks share one
    `useSyncExternalStore` path.
  - `useFsmSelector` builds its snapshot reader each render instead of keeping the latest `selector`
    and `isEqual` in refs. Only a `source` change resubscribes, as before, and a new `selector` or
    `isEqual` still recomputes against the current snapshot. It now compares snapshots with `Object.is`,
    as `useSyncExternalStore` does, so a change from `-0` to `+0` re-renders.
  - `useFsm` keys its effect on the machine alone and remembers only the machine it last tore down,
    instead of a generation counter and a set of every dead machine. It still throws when `create`
    returns the machine it just tore down. A `create` that alternates between machines torn down
    earlier is no longer detected.
  - `useFsm` updates its `create`, `attach`, and `teardown` references when a render commits
    instead of during render, so a render React discards (a suspended transition, for example) can
    no longer replace the callbacks the committed machine's cleanup runs. Before, such a render
    could skip `teardown` on unmount.
  - The `'use client'` directive comes from tsup's `banner` option with tree-shaking off, replacing the
    post-build step that rewrote the output and its source maps.

## 1.0.0

### Patch Changes

- 104d13d: Re-export the shared core `FsmSubscribable` structural port while keeping the React hook API source-compatible.
- Updated dependencies
  - @bazariodev/fsm@1.0.0

## 0.1.0

Initial release.
