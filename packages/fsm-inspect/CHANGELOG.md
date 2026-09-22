# @bazariodev/fsm-inspect

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
