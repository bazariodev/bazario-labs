# @bazariodev/fsm-inspect

## 1.1.2

### Patch Changes

- Build the JavaScript package with the shared Rollup script. Preserve ESM and CommonJS exports, source maps, and public declaration files.

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

- Simplify the inspection module and move its implementation to plain JavaScript with a hand-written
  public `index.d.ts`, shipped as matching ESM `.d.ts` and CommonJS `.d.cts` declarations. Export
  names and entry shapes are unchanged.

  - `instrumentFsmConfig` wraps only the two transition hooks and each state's `onEnter`. Each copied
    state holds only `onEnter` and `onLeave`, read by name, so hooks a state inherits (a class
    instance, for example) are kept, as the core keeps them.
    Transitions and reducers pass through unchanged, and the wrappers call the original hooks with
    the receiver the core passes, so a transition hook written as a method now gets the machine as
    `this` as it does without instrumentation.
  - Aborted attempts are no longer tracked. The open attempt is kept per machine, keyed by the
    machine the core passes to the transition hooks as `this`, so an aborted attempt still leaves an
    unmatched `transition-start`, later attempts still pair, and a nested attempt that aborts inside
    an outer attempt's hook no longer changes the outer `transition`'s id. Calling a wrapped
    transition hook without a receiver now throws a `TypeError`.
  - Checks remain only where a mistake would otherwise fail silently: recorder options, and that
    `instrumentFsmConfig` and `recordSource` receive an `InspectRecorder`. A config, source, or options
    object the module cannot read now throws a `TypeError`, a graph error in an instrumented config
    throws from the `Fsm` constructor, and a hook that is not a function throws from the send that
    calls it. An empty `recordSource` name is no longer rejected.
  - The Mermaid renderers throw only when a diagram references an undeclared state (initial state,
    transition source or target, child key), and the message names it. `wildcard` is no longer
    validated (any value other than `'expand'` draws notes), a `null` event map is skipped as in the
    core, and an empty definition array draws no edge. A transition is marked `[guarded]` only when
    its `guard` is truthy, the same test the core uses.
  - `mermaidFromFsmConfig` renders a flat config as a hierarchy without children, so both renderers
    share one id scheme. The Mermaid source changes, the rendered diagram does not: every state is
    declared as `state "<name>" as <id>`, ids are sanitized from the state's path in declaration
    order, and escaped characters use numeric entity codes (`"` is `#34;` instead of `#quot;`).
  - `wildcard: 'expand'` no longer draws a wildcard edge from a state that has its own entry for
    that event, since the core never falls back to the wildcard there.
  - A clock returning a non-finite value no longer drops entries; the value is recorded as `at`.
  - The `init` entry names the state the machine starts in, so a config whose `initial` changes after
    instrumentation (for example through `restoreFsmConfig`) still records it. A state named
    `__proto__` is no longer lost.
  - `recordSource` treats a listener call with `undefined` as a call without a payload. A snapshot
    whose capture failed is not recorded when it is delivered again.
  - A `log` entry keeps a `meta` key when `mapMeta` returns `undefined`.

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

### Minor Changes

- Add the initial FSM inspection module with timeline recording, logger capture, source commit recording, and Mermaid diagram export.

### Patch Changes

- Updated dependencies
  - @bazariodev/fsm@1.0.0
