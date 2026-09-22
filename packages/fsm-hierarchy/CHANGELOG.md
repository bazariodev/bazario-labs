# @bazariodev/fsm-hierarchy

## 1.1.0

### Minor Changes

- Simplify the hierarchy runtime and move its implementation to plain JavaScript with a hand-written
  public `index.d.ts`, shipped as matching ESM `.d.ts` and CommonJS `.d.cts` declarations. Export
  names, routing, reconciliation, and notification order are unchanged.

  - The runtime is one class; the internal `ActiveSpine`, `NodeLifecycle`, and `HierarchyNotifier`
    helpers were folded in.
  - Tree validation still runs for the whole tree at construction. It keeps every check whose
    absence would break a later spawn (which stops the hierarchy) or silently disable a child or
    transition: state definitions must be objects, `onEnter`/`onLeave` must be functions, and
    `states`, `transitions`, `children`, and each transition event map must be plain objects
    (prototype `Object.prototype` or `null`). Arrays, `Map`s, `Date`s, and objects with a custom
    prototype are now rejected there; previously most of them were accepted and silently read as
    empty.
  - One check was removed because TypeScript covers it and a violation only throws from the send that
    uses it: `guard`/`reducer` must be functions. The `initial` must be a string check stays: a
    numeric `initial` passes the own-key lookup but fails at spawn.
  - Node-handle and hierarchy subscribers never receive an older snapshot after a newer one. When a
    subscriber sends again, the newer snapshots are still published synchronously, and the outer pass
    now skips anything older instead of delivering it afterwards. Every node ends on its latest
    snapshot; an intermediate snapshot may be skipped, as with core `Fsm`.
  - Empty state names are now rejected with `fsm-hierarchy: state names cannot be empty`. An empty
    name vanished from the dotted path, so two different active spines could report the same path.

## 1.0.1

### Patch Changes

- Simplify the core runtime. Export names are unchanged.

  - Subscribers never receive an older snapshot after a newer one. When a subscriber calls `send()`,
    the newer snapshot reaches every subscriber and the original notification pass stops, so a
    subscriber may skip an intermediate snapshot.
  - Errors thrown by guards, reducers, and hooks are rethrown unchanged and are no longer also logged.
    The logger reports only debug-level rejections and subscriber failures.
  - Configuration validation covers the state graph (name, initial state, sources, targets, `*`,
    empty entries). Value-shape checks such as "guard must be a function" were removed.
  - `TransitionMap` and `FsmDiagramConfig.transitions` are partial: states without transitions and
    `*` can be omitted. `fsm-hierarchy` accepts partial transition maps in child configs, and
    `fsm-inspect` instrumentation skips absent source entries.
  - `StateLeavePayload` is an alias of `TransitionStartPayload`.
  - The implementation is now plain JavaScript with a hand-written public `index.d.ts`, shipped as
    matching ESM `.d.ts` and CommonJS `.d.cts` declarations.

## 1.0.0

### Patch Changes

- Updated dependencies
  - @bazariodev/fsm@1.0.0

## 0.1.0

### Minor Changes

- Initial release: hierarchical composition layer for `@bazariodev/fsm`. Supports one child machine per active state, post-commit child reconciliation, deepest-first routing with bubbling, composed tree snapshots with `treeVersion`, `matches(path)`, routed node handles for effects/delays, registration-only spawn hooks with cleanup, inert disposed handles, and explicit `stop()` / `[Symbol.dispose]`.
