# ADR: FSM Delays Module

- Status: Proposed
- Date: 2026-05-31

## Context

The base core (`@bazariodev/fsm`) is synchronous and effect-free. The effects module (`@bazariodev/fsm-effects`, `Modules/Effects.md`) added state-entry effects with `AbortSignal` cancellation, cleanup, and a guarded `send`. Its "Out of scope for v1" list explicitly deferred **delays / timers as a declarative primitive**, noting "use an effect that calls `setTimeout` for now; a `delays` module can come later," and its "Extensibility direction" framed a delays module as a follow-up that builds on the runner.

Real UCaaS workflows are full of time-driven transitions:

- ring-no-answer: leave `ringing` after 30s with `NO_ANSWER`
- registration refresh: re-`REGISTER` every N seconds while `registered`
- reconnect backoff: schedule `RETRY` after an exponentially growing delay while `reconnecting`
- dialing timeout: give up on `dialing` after a ceiling

Hand-coding these as raw effects works but repeats the same `setTimeout` / `clearTimeout` / guarded-`send` boilerplate at every site, and makes the timing logic invisible to anyone reading the machine config. This module gives time-driven events a declarative home.

## Decision

We will build the delays module as a thin **composition layer on top of `@bazariodev/fsm-effects`**. A declared delay compiles to an ordinary effect that arms a timer on state entry and returns a cleanup that clears it. We do not re-implement subscription, cancellation, re-entrancy, or error handling — the effects runner already owns all of that, and a timer's cleanup is exactly the abort-driven cleanup the runner already invokes on state leave.

Concretely:

- a delay declaration `{ after, send }` becomes an effect `(snapshot, api) => { const h = scheduler.setTimeout(() => api.send(resolve(send)), resolve(after)); return () => scheduler.clearTimeout(h); }`
- because cleanup runs synchronously when the runner aborts the leaving state's controller, a pending timer is always cleared **before** the next state's work — a timer can never fire for a state the machine has already left
- `api.send` is already guarded (no-ops when the signal is aborted), so even a timer that somehow fires post-leave cannot drive the machine
- self-transitions do not restart timers (inherited from the runner's state-entry semantics)

This keeps the module tiny and guarantees its behavior tracks the effects runner's contract for free.

## Resolved decisions

These were open at drafting time and have been settled:

1. **API surface: ship both.** `compileDelays(config)` is the primitive — a pure compiler that returns an effects fragment the consumer spreads into their own `FsmEffects`, so a machine already using effects drives delays through one subscriber in merged declaration order. `FsmDelays` is a convenience runner on top that constructs and owns an internal `FsmEffects` for the common delay-only case.
2. **Repeating `every` timers are in scope for v1.** Alongside one-shot `after`, a sibling `every` spec maps to `setInterval`/`clearInterval` with the same abort-driven cleanup. This makes heartbeat and registration-refresh first-class rather than forcing raw effects.
3. **Scheduler is injectable with a global default.** The config accepts an optional `scheduler` (`{ setTimeout, clearTimeout, setInterval, clearInterval }`), defaulting to the global timer functions. Tests inject a deterministic stub clock; consumers are not coupled to `vi.useFakeTimers()`.
4. **Backoff is a primitive, not a policy.** Exponential backoff is expressed through dynamic `after: (snapshot) => ms` plus an attempt counter in `context`. A declarative retry-policy helper (max attempts, jitter, give-up event) is deferred to a follow-up once real call sites exist.

## Scope

### In scope for v1

- per-state one-shot delays: `after` (ms) → `send` an event, cancelled on leave
- per-state repeating timers: `every` (ms) → `send` an event each tick, cancelled on leave
- `after`/`every` and `send` as static values **or** functions of the entry `snapshot` (enables context-derived backoff)
- multiple specs per state and wildcard (`*`) specs (inherited from the effects runner)
- injectable scheduler with a global default
- both `compileDelays` (primitive) and `FsmDelays` (convenience runner)
- error and lifecycle reporting through the same `Logger` interface

### Out of scope for v1

- declarative retry/backoff policy DSL (max attempts, jitter, give-up event) — express backoff via dynamic `after` + context for now
- cron-style / wall-clock scheduling
- persistence of pending timers across machine recreation (in-flight timers are not persistable, mirroring the effects module's stance on in-flight effects)
- pausing / resuming timers
- delay-to-delay dependencies or ordering guarantees beyond declaration order

## Delay contract

```ts
type Resolvable<T, TState extends string, TContext> =
  | T
  | ((snapshot: FsmSnapshot<TState, TContext>) => T);

type AfterSpec<TState extends string, TEvent extends FsmEvent, TContext> = Readonly<{
  after: Resolvable<number, TState, TContext>;          // milliseconds, >= 0; one-shot
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;                                          // for logs/diagnostics
}>;

type EverySpec<TState extends string, TEvent extends FsmEvent, TContext> = Readonly<{
  every: Resolvable<number, TState, TContext>;          // milliseconds, > 0; repeating
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;
}>;

type DelaySpec<TState extends string, TEvent extends FsmEvent, TContext> =
  | AfterSpec<TState, TEvent, TContext>
  | EverySpec<TState, TEvent, TContext>;

type DelaysConfig<TState extends string, TEvent extends FsmEvent, TContext> = Readonly<{
  delays: Partial<
    Record<TState | '*', DelaySpec<TState, TEvent, TContext> | ReadonlyArray<DelaySpec<TState, TEvent, TContext>>>
  >;
  scheduler?: Scheduler;
  logger?: Logger;
}>;

type Scheduler = Readonly<{
  setTimeout: (cb: () => void, ms: number) => unknown;   // returns an opaque handle
  clearTimeout: (handle: unknown) => void;
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}>;
```

Rules:

- a spec carries exactly one of `after` (one-shot) or `every` (repeating); the union type enforces this at the call site
- `after`/`every` is resolved once, at state entry, against the committed snapshot; a static value that is `< 0` (or `<= 0` for `every`), `NaN`, or non-finite fails validation at construction. A dynamic resolver that yields such a value is logged at `warn` and that spec is skipped for this entry (the rest still arm)
- `after: 0` still schedules through `setTimeout(…, 0)` — asynchronous and cancellable, never a synchronous re-entrant `send`
- `send` is resolved against the entry snapshot: once when an `after` timer fires, and on **each tick** for an `every` timer (the snapshot is the entry snapshot, not a live one; read live context in your reducer if needed)
- the timer is cleared on state leave, `stop()`, or any controller abort, before the next state's effects/delays spawn

## Cancellation

Delegated entirely to the effects runner: each delay's effect returns `() => scheduler.clearTimeout(handle)`. The runner invokes that cleanup synchronously when the state's `AbortController` aborts (leave, transition-out, or `stop()`). No timer bookkeeping lives in this module.

## Error policy

There are two distinct moments, and they are contained differently:

- the **synchronous** part of a spec (resolving `after`/`every`, arming the timer) runs inside the effects runner's effect body, so a throw there is caught and logged by the runner as `fsm-effects: effect threw`
- the **timer callback** runs later, after the effect body has returned, so it is *outside* the runner's try/catch. The delays module therefore wraps it: a throw from resolving `send`, or a machine error raised by the dispatched `api.send` (a guard/reducer/lifecycle-hook failure), is caught and logged via the delays `logger` at `error` as `fsm-delays: delayed send threw`. It never escapes as an uncaught timer exception, and a failed delayed transition leaves the machine unchanged
- `api.send` is guarded by the runner, so a timer that fires after the state was left no-ops rather than dispatching
- no auto error event — wrap your own `api.send` in a resolver/`catch` if you want a fallback event

## Validation

Construction fails fast for: a `delays` map that is not an object; entries that are not a `DelaySpec` or array of them; specs missing `after`/`send`; specs without exactly one of `after`/`every`; static `after`/`every` that is negative or non-finite (`after >= 0`, `every > 0`). State-name membership is not validated (same rationale as the effects module — `TState | '*'` constrains keys at the type level).

The injected `scheduler` shape is **not** validated at construction. It is a typed parameter with a global default, so a TypeScript caller cannot pass a malformed one; a pure-JavaScript caller who passes a bad scheduler gets a diagnosable runtime error when the timer is armed. This matches the effects module's stance of leaning on types rather than adding runtime surface.

## Public API

```ts
function compileDelays<TState extends string, TEvent extends FsmEvent, TContext>(
  config: DelaysConfig<TState, TEvent, TContext>,
): EffectsConfig<TState, TEvent, TContext>['effects'];

class FsmDelays<TState extends string, TEvent extends FsmEvent, TContext> {
  constructor(machine: FsmCore<TState, TEvent, TContext>, config: DelaysConfig<TState, TEvent, TContext>);
  stop(): void;
  [Symbol.dispose](): void;
}
```

Module exports: `compileDelays`, `FsmDelays`, and the `AfterSpec`, `EverySpec`, `DelaySpec`, `DelaysConfig`, `Scheduler` types. `compileDelays` returns a value assignable to `EffectsConfig['effects']`, so a consumer can merge it with hand-written effects (later keys win on collision — document that delay and effect maps should not share state keys unless the consumer intends to override).

## Packaging

- new package `@bazariodev/fsm-delays` in the workspace
- peer dependencies on **both** `@bazariodev/fsm` and `@bazariodev/fsm-effects` (the current major of each)
- same tooling (tsup, vitest, Biome), own changeset cadence, own README + LICENSE
- mirrors the xstate layering (`xstate` core → `@xstate/...` modules), and this repo's existing core → effects layering

## Consequences

Positive:

- delays are declarative and visible alongside the machine config
- zero new cancellation/re-entrancy logic — it rides the effects runner's guarantees
- backoff falls out of dynamic `after` + context, no extra primitive
- the module is tiny and testable against a stub scheduler

Tradeoffs:

- a second peer dependency (effects) for delay-only consumers
- timers are real async work; tests need a fake/stub scheduler for determinism
- if `every` ships (open decision 2), the surface grows beyond strict "delays"

## Next steps

1. Scaffold `packages/fsm-delays/` (package.json with peer deps on `@bazariodev/fsm` and `@bazariodev/fsm-effects`, tsconfig, tsup, vitest, README, LICENSE).
2. Define types (`AfterSpec`, `EverySpec`, `DelaySpec`, `DelaysConfig`, `Scheduler`) and the internal default scheduler + validation.
3. Implement `compileDelays`, then `FsmDelays` on top of it.
4. Tests: fires after delay, repeats on `every`, cancelled on leave, dynamic `after`/`every`/`send`, multiple + wildcard specs, no-restart on self-transition, stub-scheduler determinism, validation, `stop()` clears pending timers.
5. First changeset for `@bazariodev/fsm-delays` at `0.1.0`.

## Summary

A small composition layer that turns declarative per-state time-driven events into effects on top of `@bazariodev/fsm-effects`. v1 ships one-shot `after → send` and repeating `every → send` specs (static or context-derived, so backoff falls out of dynamic `after` + context), an injectable scheduler with a global default, and both a `compileDelays` primitive and an `FsmDelays` convenience runner. Cancellation, error handling, and re-entrancy safety are inherited from the effects runner. A declarative retry-policy helper is deferred to a follow-up.
