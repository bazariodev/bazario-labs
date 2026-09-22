# @bazariodev/fsm

## 1.1.0

### Minor Changes

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

### Major Changes

- Promote the shared structural observation and config-shape types into core for the FSM family freeze.

## 0.1.0

### Minor Changes

- Initial release of `@bazariodev/fsm`, a small, strongly typed, dependency-free finite state machine for TypeScript.

  Base core surface:

  - `Fsm` class with `name`, `snapshot`, `state`, `context` accessors and `send`, `can`, `subscribe` methods
  - frozen snapshot with `value`, `previousValue`, `context`, and monotonically incrementing `version`
  - declarative state and transition configuration with guards and synchronous context reducers
  - wildcard (`*`) source for global transitions, evaluated only when the current state does not declare the event
  - fixed lifecycle ordering: `onTransitionStart` → `onLeave` → reducer → `onEnter` → `onTransitionBeforeCommit` → commit → subscriber notification
  - re-entrant `send()` throws a plain `Error`; transactional error policy rethrows from guards, reducers, and pre-commit hooks; subscriber failures are isolated and reported through the injected logger
  - configuration validation rejects unknown initial states, unknown transition targets, `*` as a real state name or transition target, prototype-key bypass attempts, and malformed definitions
  - normalized state and transition definitions are frozen during construction so post-construction config mutation cannot change runtime behavior
  - `FsmCore` interface exported alongside the class for dependency injection and test doubles

  Out of scope for this version: async effects, timers, history, persistence, hierarchical and parallel states, and transport-specific integrations. These are intended as separate modules composed around the stable core.
