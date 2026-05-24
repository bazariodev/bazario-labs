# @bazariodev/fsm

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
