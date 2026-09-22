# ADR: Base Core FSM Architecture

- Status: Accepted
- Date: 2026-05-03
- Accepted: 2026-05-24

## Context

We are defining the FSM SDK from scratch. Previous experimental implementations should not drive the architecture.

The first priority is not maximum flexibility. The first priority is a base core that is:

- small
- simple
- strongly typed
- class-based
- extensible later without rewriting the core

The core should use private internals, public accessors, and declarative configuration. It should stay side-effect free, easy to test, and safe to extend later with optional modules.

## Decision

We will build the base FSM as a single class with a minimal public API and a narrow scope.

The base core will focus only on deterministic state machine behavior. It will not try to solve effects, timers, persistence, history, or advanced state modeling in the first version.

## Base Core Scope

### 1. FSM identity

The machine should have a name.

- `name` belongs in the constructor configuration
- `name` should be exposed as a readonly public accessor
- the name is useful for debugging, logging, and diagnostics

### 2. State storage

The core must store the current machine snapshot in a well-defined structure.

Recommended snapshot shape:

```ts
type FsmSnapshot<TState extends string, TContext> = {
  value: TState;
  previousValue: TState | null;
  context: Readonly<TContext>;
  version: number;
};
```

Notes:

- `value` is the current state name
- `previousValue` is the source state of the last committed transition; on a self-transition it equals `value`, and it is `null` immediately after construction
- `context` is the extended state
- `Readonly<TContext>` is shallow; nested fields are not frozen at runtime
- `version` starts at `0`, increments on every committed transition, and moves to `1` on the first committed transition
- the `state` accessor is a convenience alias for `snapshot.value`
- the `context` accessor is a convenience alias for `snapshot.context`
- the `snapshot` accessor returns a stable object reference for a given committed state and changes reference only when a new transition is committed
- the runtime should shallow-freeze the snapshot object itself; it does not deep-freeze context

The runtime may still use a private transition flag internally to prevent re-entrant `send()` calls, but that flag should not be part of the public snapshot in v1.

The machine should expose readonly accessors for at least:

- `name`
- `snapshot`
- `state`
- `context`

### 3. Transition storage

The base core should own transition definitions.

Transitions should be declared in configuration and normalized into private internal storage during construction.

Recommended transition shape:

```ts
type FsmEvent = { type: string };

type Guard<TContext, TEvent extends FsmEvent> = (
  context: Readonly<TContext>,
  event: TEvent,
) => boolean;

type ContextReducer<TContext, TEvent extends FsmEvent> = (
  context: Readonly<TContext>,
  event: TEvent,
) => TContext;

type TransitionDefinition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = {
  target: TState;
  guard?: Guard<TContext, TEvent>;
  reducer?: ContextReducer<TContext, TEvent>;
};

type TransitionEntry<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> =
  | TransitionDefinition<TState, TEvent, TContext>
  | Array<TransitionDefinition<TState, TEvent, TContext>>;
```

For v1, transitions should stay explicit and simple:

- every transition has a `target`
- every `target` must be a real state name and can never be `*`
- self-transitions are allowed by targeting the current state
- v1 does not distinguish between internal and external transitions

Single transition definitions and arrays are only a configuration convenience. Construction should normalize all transition entries to `Array<TransitionDefinition<...>>` internally.

The core only needs a simple deterministic resolution policy in v1:

- transitions are looked up by current state and event type
- if multiple transitions are defined for the same event, the first matching guard wins

This is enough for a simple but useful core.

### 4. Wildcard transitions

The base core should support a reserved wildcard source state for transitions that can occur from any active state.

Recommended rule:

- use `*` as a reserved transition source key
- `*` cannot be used as a real state name or as a transition target
- wildcard transitions are considered only when the current state does not define a transition entry for the event type

This supports generic transitions such as:

- reset
- cancel
- fail
- terminate

Recommended configuration direction:

```ts
type TransitionMap<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Partial<
  Record<
    TState | '*',
    Partial<Record<string, TransitionEntry<TState, TEvent, TContext>>>
  >
>;
```

Resolution order for v1:

1. look up the event type in the current state's transition bucket
2. if the current state defines an entry for that event type, resolve only within that state-specific bucket
3. only if the current state has no entry for that event type, look up the event type under `*`
4. within the selected bucket, use the first transition whose guard passes

If a state-specific event entry exists and all guards fail, the transition is rejected. The machine does not fall back to `*` in that case.

This keeps wildcard behavior predictable and prevents global transitions from accidentally shadowing state-specific transitions.

Terminal transitions are just normal transitions that often make sense under `*`, for example a global `FAIL` event targeting `failed`.

Alternative considered:

- expand wildcard transitions into every state in a small config-builder layer on top of the core

We are keeping wildcard support in the core because global transitions such as `RESET`, `CANCEL`, `FAIL`, and `TERMINATE` are common enough that repeating them in every state would add noise and encourage ad hoc wrappers in userland.

### 5. Guards

Guards belong in the base core.

They are part of transition resolution and should stay:

- synchronous
- pure
- side-effect free

If all guards fail, the transition is rejected and the current snapshot remains unchanged.

### 6. Context reducers

Replace the earlier phrase "pure actions that return context updates" with a clearer term: `contextReducer`.

The purpose is simple: compute the next context synchronously from the current context and event.

Recommended shape:

```ts
type ContextReducer<TContext, TEvent extends FsmEvent> = (
  context: Readonly<TContext>,
  event: TEvent,
) => TContext;
```

Rules:

- reducer logic is synchronous
- reducer logic is pure
- reducer logic does not perform effects
- if no reducer is configured for the selected transition, context remains unchanged
- `Readonly<TContext>` is shallow, so context should still be treated as immutable by convention
- reducer logic returns the next context instead of mutating the existing one

This keeps the base core predictable.

### 7. Transition lifecycle handlers

The following handlers belong in the base core because they are fundamental lifecycle hooks:

- `onTransitionStart`
- `onTransitionBeforeCommit`
- `onStateLeave`
- `onStateEnter`

These handlers should be:

- optional
- synchronous
- configuration-driven

They should support observability and extension later, but they should not introduce async behavior into the core.

Recommended configuration direction:

```ts
type TransitionStartPayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = {
  from: TState;
  to: TState;
  event: TEvent;
  context: Readonly<TContext>;
};

type TransitionCommitPayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = {
  from: TState;
  to: TState;
  event: TEvent;
  previousContext: Readonly<TContext>;
  nextContext: Readonly<TContext>;
};

type StateEnterPayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = {
  from: TState | null;
  to: TState;
  event: TEvent | null;
  context: Readonly<TContext>;
};

type StateLeavePayload<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = {
  from: TState;
  to: TState;
  event: TEvent;
  context: Readonly<TContext>;
};

type StateDefinition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = {
  onEnter?: (payload: StateEnterPayload<TState, TEvent, TContext>) => void;
  onLeave?: (payload: StateLeavePayload<TState, TEvent, TContext>) => void;
};

type FsmConfig<TState extends string, TEvent extends FsmEvent, TContext> = {
  name: string;
  initial: TState;
  context: TContext;
  states: Record<TState, StateDefinition<TState, TEvent, TContext>>;
  transitions: TransitionMap<TState, TEvent, TContext>;
  onTransitionStart?: (
    payload: TransitionStartPayload<TState, TEvent, TContext>,
  ) => void;
  onTransitionBeforeCommit?: (
    payload: TransitionCommitPayload<TState, TEvent, TContext>,
  ) => void;
  logger?: Logger;
};
```

Payload context semantics for v1:

- `TransitionStartPayload.context` is the current pre-reducer context
- `StateLeavePayload.context` is the current pre-reducer context
- `StateEnterPayload.context` is the next context that would be committed, or the current context when no reducer is configured
- for initial-state enter during construction, `from` is `null` and `event` is `null`
- in `StateEnterPayload`, `from: null` and `event: null` only occur together during initial-state enter; otherwise both are non-null

V1 keeps all four hooks intentionally.

- `onStateEnter` and `onStateLeave` are the state-local hooks
- `onTransitionStart` and `onTransitionBeforeCommit` are the transition-level pre-commit seam for invariants, audit logging, and future extension

Lifecycle ordering must be fixed in the ADR to avoid implementation drift.

Recommended v1 order for `send(event)`:

1. acquire the private transition lock at the start of `send()` processing
2. resolve transition by current state, event type, wildcard fallback, and first-passing guard
3. if no transition is accepted, clear the lock and exit without changing the snapshot
4. call `onTransitionStart`
5. call `onStateLeave` if the target differs from the current state
6. apply `contextReducer` to compute the next context, or keep the current context when no reducer is configured
7. build the next snapshot with updated `value`, `previousValue`, `context`, and `version + 1`
8. call `onStateEnter` if the target differs from the current state
9. call `onTransitionBeforeCommit`
10. commit the next snapshot
11. clear the private transition lock
12. notify subscribers

The transition lock must be acquired before any guard evaluation and cleared on every exit path, including rejection and thrown errors.

During all pre-commit hooks, the public accessors `snapshot`, `state`, and `context` still return the last committed snapshot. Hook implementations should rely on the payload they receive rather than reading machine accessors.

Self-transition rule for v1:

- `onTransitionStart` and `onTransitionBeforeCommit` do fire
- `onStateLeave` and `onStateEnter` do not fire

### 8. Subscription to state change

Subscriptions belong in the base core.

The machine should provide a small public subscription API so consumers can observe committed snapshot updates.

Recommended public method:

```ts
type FsmSubscriber<TState extends string, TContext> = (
  snapshot: FsmSnapshot<TState, TContext>,
) => void;

type Unsubscribe = () => void;

subscribe(listener: FsmSubscriber<TState, TContext>): Unsubscribe
```

Subscribers should be notified only after a transition is committed.

The machine should snapshot the current subscriber list before notification starts so subscribe or unsubscribe calls during a callback do not change the current delivery pass.

`Unsubscribe` is idempotent. Calling it after the subscriber has already been removed is a no-op.

If a subscriber triggers a nested transition via `send()`, the nested notification pass delivers the newer snapshot to every subscriber. The original pass then stops, so no subscriber receives an older snapshot after a newer one. The delivery rule is: every subscriber ends on the latest snapshot, and a subscriber may skip an intermediate snapshot produced by a nested send. The snapshot argument always equals `machine.snapshot` at the moment it is delivered.

Subscriber failures should not block other subscribers. If a subscriber throws, the machine should continue notifying the remaining subscribers and report the failure through the injected logger.

### 9. Logger

Logger support belongs in the base core, but only as an injected dependency.

Recommended approach:

- accept an optional `logger` in the constructor configuration
- use a small logger interface
- default to a no-op logger
- never depend directly on `console`

Recommended shape:

```ts
type Logger = {
  debug(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};
```

This keeps logging optional and testable.

### 10. Validation

Configuration validation belongs in the base core.

The constructor should fail fast for invalid configuration such as:

- missing initial state
- transition target that does not exist
- transition source states other than `*` that do not have corresponding entries in `states`
- an empty transition definition array
- empty `name`
- use of `*` as a real state name
- use of `*` as a transition target (rejected because `*` is never a declared state)

State membership checks must only consider own keys, so prototype keys such as `toString` cannot satisfy validation. State and transition definitions are copied into private internal maps during construction so callers cannot mutate runtime behavior by changing their config object afterwards; the private copies are not frozen because nothing outside the instance can reach them.

Non-goals: the base core validates the state graph, not value shapes. It does not perform `typeof` or object-shape validation of `name`, `initial`, the `logger`, the `states`/`transitions` maps, or the `target`, `guard`, `reducer`, `onEnter`, and `onLeave` fields. The package is TypeScript-first and the generic constraints already enforce these. Pure JavaScript callers that pass malformed values will receive a generic `TypeError` from the offending operation rather than a curated message. This is intentional to keep validation surface narrow; a separate input-hardening layer can sit on top of the core if a future use case requires it.

## Minimal Public API

The first version should keep the public API intentionally small.

Recommended public surface:

- `new Fsm<TState, TEvent, TContext>(config)`
- `name`
- `snapshot`
- `state`
- `context`
- `send(event)`
- `can(event)`
- `subscribe(listener)`

The package also exports an `FsmCore<TState, TEvent, TContext>` interface that mirrors the class's public surface. The class explicitly implements this interface. Consumers may depend on `FsmCore` instead of the concrete class for dependency injection and test doubles. The interface is a documented seam, not an extension point — the class remains the only runtime implementation shipped by this package.

Recommended class shape:

```ts
class Fsm<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> {
  constructor(config: FsmConfig<TState, TEvent, TContext>);

  readonly name: string;
  readonly snapshot: FsmSnapshot<TState, TContext>;
  readonly state: TState;
  readonly context: Readonly<TContext>;

  send(event: TEvent): void;
  can(event: TEvent): boolean;
  subscribe(
    listener: FsmSubscriber<TState, TContext>,
  ): Unsubscribe;
}
```

For v1, `send(event)` returns `void`. Consumers that need the result of a transition should read `machine.snapshot` after the call.

Recommended constructor shape:

```ts
new Fsm<TState, TEvent, TContext>(
  config: FsmConfig<TState, TEvent, TContext>,
)
```

We should avoid adding more public methods until a real use case requires them.

## Private Runtime Responsibilities

The class should keep its operational logic private.

Expected private responsibilities:

- config validation
- transition lookup
- wildcard transition fallback
- guard evaluation
- transition lock management
- reducer application
- lifecycle handler invocation
- subscriber notification
- logging

## Missing Items We Should Define Now

The reviewed list is good, but a few base-core rules are still needed:

### 1. Event shape

Define the base event contract now and use it as the generic constraint for the machine.

Recommended base event type:

```ts
type FsmEvent = { type: string };
```

Machine generics should follow this rule:

```ts
TEvent extends FsmEvent
```

### 2. Rejected transition behavior

Define what happens when:

- an event is unknown
- no transition matches
- guards fail

The v1 rule should be:

- keep the snapshot unchanged
- do not increment `version`
- do not notify subscribers
- optionally log at debug level

If the current state defines a transition entry for the event type and all guards fail, reject the event without falling back to `*`.

### 3. Re-entrancy policy

Re-entrancy must be defined in v1.

If `send()` is called while another transition is already being processed, the machine should throw.

In v1, this should be a plain `Error` with a clear message rather than a custom error class.

This is the simplest and safest first rule. Event queuing can be considered later if real use cases require it.

### 4. `can(event)` semantics

`can(event)` should accept the full event object, not only the event type.

This matters because guards may depend on event payload.

The v1 rule should be:

- run the same lookup and guard resolution path as `send(event)`
- include wildcard transition fallback
- if the current state defines the event type and all guards fail, return `false` without checking `*`
- never throw solely because a transition is already in progress; evaluate against the last committed snapshot
- do not invoke reducers
- do not invoke lifecycle handlers
- do not commit snapshot changes
- do not notify subscribers

### 5. Initialization behavior

Define whether initial state hooks run in the constructor or in an explicit `start()` method.

To keep the API small, constructor-based initialization is the v1 choice.

That means:

- the initial snapshot is ready immediately after construction
- the initial state is considered active immediately
- `previousValue` is `null` on construction
- `version` is `0` on construction
- `onStateEnter` for the initial state runs during construction
- initial-state `onStateEnter` receives `from: null` and `event: null`
- `onTransitionStart` and `onTransitionBeforeCommit` do not run during construction because no transition is being resolved
- if initial-state `onStateEnter` throws during construction, the constructor rethrows and no machine instance is exposed to the caller
- subscribers only observe transitions that happen after construction

### 6. Error policy

Define what happens if a guard, reducer, or lifecycle handler throws.

The v1 rule should be transactional for machine logic and non-transactional for subscribers.

- if a guard throws, do not commit and rethrow from `send()`
- if a reducer throws, do not commit and rethrow from `send()`
- if `onTransitionStart` throws, do not commit and rethrow from `send()`
- if `onStateLeave` throws, do not commit and rethrow from `send()`
- if `onStateEnter` throws, do not commit and rethrow from `send()`
- if `onTransitionBeforeCommit` throws, do not commit and rethrow from `send()`
- if a subscriber throws, keep the committed snapshot, continue notifying remaining subscribers, and report the error through the logger

User-thrown errors are propagated verbatim and are not wrapped by the FSM runtime. Because the caller receives them, the runtime does not also log them; the logger reports only failures it swallows (subscribers) and debug-level rejections.

In all rejected or error paths, the transition lock is released before control returns to the caller.

## Out Of Scope For Base Core

To keep the first version small and simple, the following are out of scope:

- async effects
- delays and timers
- history
- persistence
- hierarchical states
- parallel states
- transport-specific integrations
- plugin systems more complex than configuration hooks and subscriptions

These can be added later as separate modules built around the stable core.

## Extensibility Direction

Extensibility still matters, but we should keep the first decision lightweight.

The base core should expose a stable class API that future features can compose around. For now, that means:

- build a clean class-based core first
- keep optional features out of the base runtime
- prefer composition around the class instance over subclassing
- add feature modules only after the base core is stable and tested

The supported extension seams in v1 are:

- constructor configuration for declarative injection of transitions, guards, reducers, state hooks, transition hooks, and logger
- `subscribe()` for post-commit observation
- external orchestration around `send()` for timers, retries, async glue, and cross-machine coordination
- logger injection for observability

`subscribe()` is intentionally a post-commit seam. The transition lock is cleared before subscribers are notified, so subscriber callbacks may call `send()` to begin a new transition.

The following are intentionally not extension seams in v1:

- transition resolution internals
- mid-transition state mutation
- subclassing the machine to override runtime behavior

We do not need to fully design effects or a plugin system in this ADR.

## Consequences

Positive consequences:

- the core stays easy to understand
- the first implementation remains small
- lifecycle behavior is explicit
- wildcard transitions support common global flow handling without complicating the core
- transition semantics are fixed before implementation starts
- the runtime is easier to test and document
- future features can build on a stable class contract

Tradeoffs:

- the first version will intentionally do less
- wildcard transitions introduce one reserved key, `*`, that must be validated consistently
- some advanced extension patterns are deferred
- future feature modules may require one or two additional seams once real use cases appear

## Next Steps

1. Define the core types: config, snapshot, event, transition, guard, reducer, logger, and transition map with wildcard support.
2. Define the class contract with private methods and readonly public accessors.
3. Write focused tests for state storage, exact transition resolution, wildcard transition fallback, guards, lifecycle handlers, subscriptions, and logging.
4. Revisit optional features only after the base core API is stable.

## Summary

The FSM SDK should start with a small class-based base core. That core should own state storage, transition storage, wildcard transition fallback, guards, synchronous context reducers, lifecycle handlers, subscriptions, naming, logging, and validation. Everything else should wait until the core is stable.