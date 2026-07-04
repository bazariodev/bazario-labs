# @bazariodev/fsm-hierarchy

## 0.1.0

### Minor Changes

- Initial release: hierarchical composition layer for `@bazariodev/fsm`. Supports one child machine per active state, post-commit child reconciliation, deepest-first routing with bubbling, composed tree snapshots with `treeVersion`, `matches(path)`, routed node handles for effects/delays, registration-only spawn hooks with cleanup, inert disposed handles, and explicit `stop()` / `[Symbol.dispose]`.
