# ADR: FSM Effects Module

- Status: Accepted
- Date: 2026-05-24
- Accepted: 2026-05-31

## Context

The base core (`@bazariodev/fsm` v0.1) is intentionally synchronous and effect-free. Real UCaaS workflows need asynchronous work tied to states:

- send a SIP INVITE when entering `dialing`
- start a ringback tone on `ringing`, stop it on leave
- start a heartbeat ping on `connected`, cancel on leave
- schedule a reconnect retry with backoff when entering `reconnecting`

Today these would all be hand-coded around `subscribe()`. We want a first-class module that runs effects on state entry, cancels them on leave, and feeds events back into the machine — without coupling the base core to async behavior.

The ADR for the base core (`Base/CoreFSM.md`) explicitly defers async effects and lists "external orchestration around `send()` for timers, retries, async glue" as the supported extension seam. This module fills that seam.

## Decision

We will build the effects module as a composition layer around an existing `Fsm` instance. The base core stays unchanged. The module:

- attaches effects to states (entry + cleanup), not to transitions
- spawns effects after a transition commits, cancels them before the next state's effects spawn
- exposes an `AbortSignal` for async work and accepts an optional cleanup function for synchronous resources
- provides a guarded `send` so effects can drive the machine without violating the re-entrancy lock
- never mutates the machine's snapshot or transition resolution

This keeps the runtime surface narrow and lets effects evolve independently of the core.

## Resolved decisions

These were open at drafting time and have been settled:

1. **Packaging.** Separate package `@bazariodev/fsm-effects` in the same workspace, with a peer dependency on `@bazariodev/fsm`. Independent versioning, mirrors the "feature modules around a stable core" framing.
2. **Effect scope.** State-entry only for v1. Transition-level effects can be modeled today by reading `snapshot.previousValue` inside a state effect; a dedicated `onTransition` shape can be added later if real use cases demand it.
3. **Auto-event on effect failure.** No. A thrown or rejected effect is logged and contained. Userland can explicitly `api.send({ type: 'EFFECT_FAILED', ... })` inside its own catch if it wants that behavior.

## Scope

### In scope for v1

- state-entry effects with synchronous or async bodies
- `AbortSignal` cancellation tied to leaving the state
- optional cleanup callback for imperative resources (timers, intervals, event listeners)
- guarded `send` available to effects
- multiple effects per state
- wildcard (`*`) effects that run for every active state
- initial-state effects fired during runner construction
- explicit `stop()` to cancel all effects and detach
- error and lifecycle reporting through the same `Logger` interface the core uses

### Out of scope for v1

- transition-level effects (`onTransition`)
- delays / timers as a declarative primitive (use an effect that calls `setTimeout` for now; a `delays` module can come later)
- effect-to-effect dependency graphs
- automatic retry / backoff policies
- a "spawn child machine" primitive
- persistence of in-flight effect state across machine recreation
- effect priorities or ordering guarantees beyond declaration order

These can be added as separate modules once the v1 runner is stable.

## Effect contract

```ts
type EffectApi<TEvent extends FsmEvent> = Readonly<{
  signal: AbortSignal;
  send: (event: TEvent) => void;
}>;

type EffectCleanup = () => void;

type Effect<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = (
  snapshot: FsmSnapshot<TState, TContext>,
  api: EffectApi<TEvent>,
) => void | EffectCleanup | Promise<void | EffectCleanup>;
```

Rules:

- the effect receives the snapshot reference that was committed when this entry was scheduled; per the core's shallow-freeze rule (`Base/CoreFSM.md` §2) the runner does not clone or deep-freeze `snapshot.context`, so consumer-side mutation of context will be visible
- the snapshot carries `value`, `previousValue`, `context`, and `version`; this is what makes the transition-effect workaround (`snapshot.previousValue === 'X' ? ... : ...`) viable inside a wildcard or state-entry effect
- `api.signal` aborts when the state is left, when the machine transitions out via the runner, or when `stop()` is called on the runner
- `api.send` no-ops silently when `signal.aborted` is `true`, so effects do not need to guard every call site
- when `signal.aborted` is `false`, `api.send` delegates directly to `machine.send`. Errors raised by the machine (guards, reducers, lifecycle hooks — per the core's error policy in `Base/CoreFSM.md`) propagate synchronously to the effect's call site. The runner adds no special handling for them: if the effect catches the error (wrapping its `api.send` in `try`/`catch`) it observes the original machine error verbatim; if the effect does **not** catch it, the throw escapes the effect body and is contained by the Error policy below exactly like any other synchronous throw from an effect — caught, logged as `fsm-effects: effect threw`, and not crashing the runner. The runner never auto-sends an error event either way.
- a synchronous return value of `void` means "no cleanup needed"
- a synchronous return of a function is treated as a cleanup callback and invoked when the signal aborts
- a `Promise<void>` is awaited only for error reporting; the runner does not block on it
- a `Promise<EffectCleanup>` is awaited; the resolved cleanup runs on abort, even if the abort happened before the promise resolved (cleanup runs immediately on settle in that case)

## State-level effect declaration

```ts
type EffectsConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  effects: Partial<
    Record<
      TState | '*',
      | Effect<TState, TEvent, TContext>
      | ReadonlyArray<Effect<TState, TEvent, TContext>>
    >
  >;
  logger?: Logger;
}>;
```

- a single function or an array of functions is accepted (mirrors the transitions config shape)
- multiple effects on the same state run in declaration order, independently
- effects for the current state and `*` both run on every entry; `*` effects do **not** shadow state-specific effects (unlike wildcard transitions, which only fire when the state has no matching event)
- the optional `logger` is independent from the machine's. If omitted, the runner uses a no-op logger. Consumers who want unified logging pass the same `Logger` instance to both constructors; `FsmCore` does not expose its logger so the runner cannot reach it automatically.

## Lifecycle integration

The runner registers itself as a subscriber on the machine during construction. Subscriber callbacks run synchronously during the machine's notification pass, in registration order (`Base/CoreFSM.md` §8). Everything below happens inside the runner's subscriber callback — there is no microtask hop, no out-of-band scheduling.

For an accepted transition `A → B` (where `A !== B`):

1. machine commits, then begins its notification pass
2. when the pass reaches the runner, the callback fires with the new snapshot
3. the runner applies the version guard, creates the new controller and commits bookkeeping, aborts the previous controller, then spawns the new state's effects (full ordering in "For stale subscriber callbacks and re-entrant `api.send`" below)
4. the runner returns from the callback; the machine continues delivering the snapshot to the remaining subscribers

For initial-state effects:

- the runner constructor captures `machine.snapshot` once at construction time. The initial state is that snapshot's `value`; the runner does not read `config.initial` from the machine config (which it cannot access through `FsmCore`).
- ordering inside the constructor is fixed: capture the snapshot, normalize the config (see "Config isolation" below), commit notification bookkeeping (`#processedState = snapshot.value`, `#lastProcessedVersion = snapshot.version`), build the initial `AbortController`, **then subscribe to the machine**, **then** spawn the state-specific and `*` effects. The subscription must be in place before any effect runs so that a synchronous `api.send` from an initial effect is delivered back into the runner instead of being missed.
- the constructor returns only after effects have been scheduled (not necessarily resolved)

For rejected transitions:

- runner sees nothing because the machine does not notify on rejection — no effect work happens

For self-transitions (`A → A`):

- effects are **not** restarted, matching the existing rule that `onStateLeave` and `onStateEnter` do not fire on self-transitions
- the runner detects self-transitions by comparing the incoming snapshot's `value` with its notification tracker (`#processedState`); it does not rely on `snapshot.previousValue`

For stale subscriber callbacks and re-entrant `api.send`:

The base core delivers subscriber callbacks against a snapshotted subscriber list (`Base/CoreFSM.md` §8). Any subscriber — or any effect or cleanup calling `api.send`/`machine.send` — can trigger a nested commit while the runner is still mid-work. The runner serializes all of it through a single **drain loop** so that effect spawning never interleaves with cleanup execution. The rule holds for both ordinary and nested invocations:

1. on every callback, if `snapshot.version <= #lastProcessedVersion`, **skip and return** (this commit has already been processed by a nested invocation)
2. otherwise, set `#lastProcessedVersion = snapshot.version`
3. if `snapshot.value === #processedState`, it is a self-transition — return without further work; otherwise update `#processedState = snapshot.value`
4. otherwise, record the snapshot as the pending target (`#pending`). If a drain loop is already running (`#draining`), **return** — the active loop owns all controller and spawn work; the nested call has only handed it the newer target
5. otherwise run the drain loop until there is no pending target (or the runner is stopped). Each turn takes the pending target as `next`, clears `#pending`, and:
   1. creates the new controller (`#controller = newController`) before aborting anything. Notification sequencing is tracked separately in `#processedState`, so this provisional controller assignment is not used to decide whether later nested callbacks are self-transitions.
   2. aborts the previous controller. This fires the leaving state's cleanups synchronously, in registration order. A cleanup that calls `send()` re-enters at step 4, sets `#pending`, and returns (because `#draining` is `true`) — so **every** leaving-state cleanup finishes before any further work, and none of them interleave with the entered state's effects
   3. if `stop()` was called during the cleanups, break out of the loop
   4. if the cleanups produced a new `#pending` target, the machine has moved past `next`; **skip spawning** it and let the loop process the newer target on its next turn
   5. otherwise spawn the state-specific effects in declaration order, then the `*` effects
   6. **between each spawn**, if the controller's `signal.aborted` is `true` (e.g. `stop()`) or an effect's `send()` queued a new `#pending` target, stop the spawn loop; the loop's next turn aborts this controller (running any cleanups the partial spawn registered) and advances to the newer target
   7. if a synchronous cleanup is returned from an effect whose controller is already aborted by the time the runner stores it, the runner invokes the cleanup immediately rather than holding a reference that will never fire

Intermediate states a synchronous cascade only passes through (step 5.4) do **not** get their effects spawned; only the state the machine comes to rest on does.

## Cancellation

- the runner holds one `AbortController` per active state
- on state leave, the runner calls `controller.abort()` before spawning the next state's effects
- if an effect returned a synchronous cleanup, it is invoked on abort
- if an effect returned a `Promise<EffectCleanup>`, the cleanup is invoked when the promise resolves, even if abort fired first
- `stop()` aborts the current controller and unsubscribes from the machine — subsequent transitions are ignored

The runner makes no attempt to track effect completion. An effect that ignores the signal and does long-running work after abort will continue to run; the cost of forcing termination would be heavy and not portable.

## Error policy

- a synchronous throw from an effect body is caught, logged at `error`, and does not crash the runner
- a rejected promise from an async effect body is caught (via the runner's internal awaiter) and does not crash the runner
- rejection level is conditional: if `signal.aborted` is `true` at the moment the rejection settles, the runner logs at `debug` (typical for wrapped `fetch` raising `AbortError`); otherwise it logs at `error`
- a throw from a cleanup callback is caught, logged at `error`, and does not block other cleanups on the same controller
- effects do not auto-send any error event; if the consumer wants that, the effect calls `api.send({ type: 'EFFECT_FAILED', ... })` in its own catch

Subscriber error semantics in the machine are unchanged. The runner is a subscriber; if the runner itself throws (it shouldn't), the existing base-core rule applies — log and continue with other subscribers.

## Stop

```ts
runner.stop(): void
runner[Symbol.dispose](): void  // alias for stop()
```

- aborts the current state's `AbortController`
- unsubscribes from the machine
- subsequent machine transitions cause no effect work
- calling `stop()` twice is a no-op
- `[Symbol.dispose]` is implemented as a one-line alias to `stop()` so consumers on supporting toolchains can use the TC39 `using` declaration; the runner has no other resource-management surface

## Validation

The runner constructor fails fast for:

- effects map that is not an object
- effect entries that are not functions or arrays of functions
- effect arrays that contain non-function entries

State name membership against the machine config is **not** validated. `FsmCore` does not expose declared state names, and the `EffectsConfig` type already constrains keys to `TState | '*'`, so TypeScript catches typos at the call site. Pure-JavaScript callers who pass an unknown key will see their effect silently never fire — diagnosable, and not worth the runtime surface to catch.

## Config isolation

During construction the runner normalizes each effect entry into a private frozen array. A single function is wrapped in a one-element array; a user-supplied array is copied. Subsequent mutation of the consumer's `config.effects` map, replacement of an entry, or splicing into the original arrays does not change runtime behavior — the runner iterates its own copies.

Function references are captured at construction time and not deep-cloned (functions cannot be cloned in any useful way). Reassigning a property *inside* the effect's closure remains the consumer's responsibility; that is normal JavaScript and not something the runner can or should defend against.

This mirrors the base core's freeze-on-construction rule for states and transitions (`Base/CoreFSM.md` §10).

## Public API

```ts
class FsmEffects<TState extends string, TEvent extends FsmEvent, TContext> {
  constructor(
    machine: FsmCore<TState, TEvent, TContext>,
    config: EffectsConfig<TState, TEvent, TContext>,
  );

  stop(): void;
  [Symbol.dispose](): void;
}
```

Module exports:

- `FsmEffects` (class)
- `Effect`, `EffectApi`, `EffectCleanup`, `EffectsConfig` (types)

The runner depends on `FsmCore`, not on the concrete `Fsm` class, so consumers can substitute test doubles.

## Composition vs in-core

The runner is built on the public `subscribe` seam. It does not access private machine internals. This means:

- the core stays small and effect-free
- the effects module can release on its own cadence
- consumers who do not want effects pay nothing
- effect bugs cannot corrupt machine state
- the same composition pattern works for future modules (persistence, delays)

The cost is one extra object to construct. Effect spawn is synchronous inside the runner's subscriber callback — no microtask hop, no scheduling overhead.

## Packaging

The module ships as a separate package `@bazariodev/fsm-effects` in the existing workspace.

- `packages/fsm-effects/package.json` with peer dependency on `@bazariodev/fsm` (range: the current major)
- own changeset cadence and version line
- own `README.md` and tests, same tooling (tsup, vitest, Biome)
- mirrors the xstate pattern (`xstate` core, `@xstate/...` modules)
- the base core stays unchanged, preserving the "Out of scope" promise from `Base/CoreFSM.md`

## Out of scope reminders

This ADR does not define:

- a delays/timers DSL (since shipped as `@bazariodev/fsm-delays`; see `Modules/Delays.md`)
- a hierarchical-states model (now drafted in `Modules/Hierarchy.md`)
- a persistence story (a separate module can snapshot machine state and rehydrate; in-flight effects are *not* persistable by design)

## Extensibility direction

The v1 runner exposes two seams future modules can build on:

- a public `FsmEffects` class that wraps an `FsmCore` — enough for most users
- an internal effect-spawning function shape that delays/retries/etc. modules can re-use rather than re-implement

We are not designing those future modules now.

## Consequences

Positive:

- the base core remains effect-free
- async work has one canonical home with clear cancellation semantics
- effect failures cannot corrupt machine state
- the runner is testable in isolation against a stub `FsmCore`
- self-transition behavior stays consistent with existing state hook rules

Tradeoffs:

- the runner introduces a second object the consumer has to manage (construction + `stop`)
- effects that synchronously `send` cause cascading runner work — predictable but worth documenting
- async cleanup tracking adds a small amount of bookkeeping per active state
- if the consumer never calls `stop()`, leaked effects can outlive the machine — explicit responsibility, not automatic

## Next steps

1. Scaffold `packages/fsm-effects/` with `package.json` (peer dep on `@bazariodev/fsm`), `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `README.md`, and `LICENSE`.
2. Define the type module: `Effect`, `EffectApi`, `EffectCleanup`, `EffectsConfig`.
3. Implement the runner: subscription wiring, per-state `AbortController`, cleanup queue, guarded `send`, `stop()`.
4. Write focused tests: initial-state effects, initial effect that sends immediately is received by the runner (proves subscription happens before spawn), transition cancels old + spawns new, self-transition skip, wildcard effects, multi-effect ordering, sync error containment, async error containment, abort-aware rejection log level, `stop()` semantics, send-from-effect re-entry, synchronous nested `send` during spawn loop stops remaining effects in that loop, stale subscriber callbacks skipped by version guard, cleanup-after-already-aborted (sync and async), `api.send` propagates machine errors when signal not aborted, post-construction config mutation does not change behavior.
5. First changeset for `@bazariodev/fsm-effects` at `0.1.0`.

## Summary

The effects module is a composition layer that runs declarative state-entry effects around a `FsmCore` instance. It owns cancellation, cleanup, and error containment for async work without modifying the base core. v1 supports state-entry effects, wildcard effects, sync and async bodies, `AbortSignal` cancellation, optional cleanup callbacks, and an explicit `stop()` method. Transition-level effects, declarative delays, and persistence are deliberately deferred to follow-up modules.
