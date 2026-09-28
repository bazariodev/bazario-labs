# @bazariodev/keepalive

## 0.1.1

### Patch Changes

- Rewrite the package README so it stands on its own: install steps with peer dependencies, a minimal
  example first, behavior as short rules, and option tables. Document behavior that was missing, such
  as effect ordering, hierarchy child re-creation and node paths, persistence options and restore
  order, and inspection entry types. Link related packages to their npm pages. Include `CHANGELOG.md`
  in the published package. In FSM Delays, correct the `Resolvable` doc comment. These documentation
  and packaging changes don't change runtime behavior or types.
- Updated dependencies
  - @bazariodev/idle-watchdog@0.1.1

## 0.1.0

### Minor Changes

- a9080be: Add a connection liveness orchestrator composed over two idle watchdogs. Monitor inactivity and
  invoke an injected abortable promise probe with a configured deadline. Consumers own request/response
  matching and validation. Expose start, activity, probeNow, onFail, and terminal disposal. Abort pending
  work and fail once on timeout, rejection, or synchronous error; explicit stop is silent and recovery
  remains with the parent. Ignore late settlement and coalesce repeated probes.
  Report missing or invalid probe results as operation errors when invoked.
  Require integer idle and deadline durations from 1 through 2,147,483,647 milliseconds. Ship plain
  JavaScript ESM/CJS with public TypeScript declarations and an idle-watchdog workspace dependency.

### Patch Changes

- Updated dependencies [fd0e2b9]
  - @bazariodev/idle-watchdog@0.1.0
