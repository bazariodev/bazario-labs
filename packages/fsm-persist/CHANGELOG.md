# @bazariodev/fsm-persist

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
