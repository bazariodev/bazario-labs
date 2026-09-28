# @bazariodev/fsm-persist

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

- Simplify the persistence module and move its implementation to plain JavaScript with a hand-written
  public `index.d.ts`, shipped as matching ESM `.d.ts` and CommonJS `.d.cts` declarations. Export
  names, the record format, write-through behavior, and the never-throw read side are unchanged.

  - Option validation is unchanged: persistence failures are logged to a no-op logger by default, so
    a misconfigured option would otherwise silently disable persistence.
  - A sparse hierarchy spine, which only a custom `deserialize` can produce, is rejected as an
    invalid record instead of being treated as an unknown state or a partial restore.
  - Stored state values are read once during validation, so a getter from a custom `deserialize`
    can no longer replace a validated value with an invalid one.
  - A child config in a hierarchy restore only needs to be an object to be walked into; its other
    fields are the consumer's own config, not stored data.

## 1.0.0

### Minor Changes

- 104d13d: Add the initial FSM persistence module with write-through storage, flat and hierarchy restore helpers, versioned records, and untrusted-storage fallback semantics.

### Patch Changes

- Updated dependencies
  - @bazariodev/fsm@1.0.0
