# @bazariodev/idle-watchdog

## 0.1.1

### Patch Changes

- Rewrite the package README so it stands on its own: install steps with peer dependencies, a minimal
  example first, behavior as short rules, and option tables. Document behavior that was missing, such
  as effect ordering, hierarchy child re-creation and node paths, persistence options and restore
  order, and inspection entry types. Link related packages to their npm pages. Include `CHANGELOG.md`
  in the published package. In FSM Delays, correct the `Resolvable` doc comment. These documentation
  and packaging changes don't change runtime behavior or types.

## 0.1.0

### Minor Changes

- fd0e2b9: Add a dependency-free one-shot inactivity watchdog with explicit `arm()`, restartable cancellation,
  idle subscriptions, and terminal disposal. Injected scheduling, stale-callback protection, and
  listener-error isolation support deterministic use in realtime and other activity-driven lifecycles.
  Ship plain JavaScript ESM/CJS with public TypeScript declarations.
  Require integer durations from 1 through 2,147,483,647 milliseconds and reject invalid values with
  RangeError. Unsubscribe functions cannot remove later registrations of the same listener.
