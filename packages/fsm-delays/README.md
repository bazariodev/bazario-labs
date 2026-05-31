# @bazariodev/fsm-delays

Declarative delays and intervals for [`@bazariodev/fsm`](https://github.com/Bazariodev/bazario-labs/tree/main/packages/fsm). Attach time-driven events to states — one-shot `after` timeouts and repeating `every` intervals — that arm on entry and cancel on leave. Built on [`@bazariodev/fsm-effects`](https://github.com/Bazariodev/bazario-labs/tree/main/packages/fsm-effects).

Full design rationale: [`Delays.md` ADR](https://github.com/Bazariodev/bazario-labs/blob/main/.agent/ADR/Modules/Delays.md).

## Install

```sh
pnpm add @bazariodev/fsm-delays @bazariodev/fsm @bazariodev/fsm-effects
```

`@bazariodev/fsm` and `@bazariodev/fsm-effects` are peer dependencies.

## Usage

```ts
import { FsmDelays } from '@bazariodev/fsm-delays';

const delays = new FsmDelays(callMachine, {
  delays: {
    // ring-no-answer timeout
    ringing: { after: 30_000, send: { type: 'NO_ANSWER' } },

    // heartbeat while connected
    connected: { every: 5_000, send: { type: 'PING' } },

    // exponential reconnect backoff, derived from context
    reconnecting: {
      after: (snapshot) => Math.min(30_000, 1_000 * 2 ** snapshot.context.attempts),
      send: { type: 'RETRY' },
    },
  },
});

delays.stop(); // or `using delays = new FsmDelays(...)`
```

A spec carries exactly one of `after` (one-shot) or `every` (repeating). `after`/`every` (ms) and `send` may be static values or functions of the entry `snapshot`. Multiple specs per state and wildcard (`*`) specs are supported.

### Composing with hand-written effects

`compileDelays` returns an effects fragment you can merge into your own `FsmEffects`, so one subscriber drives both delays and effects:

```ts
import { FsmEffects } from '@bazariodev/fsm-effects';
import { compileDelays } from '@bazariodev/fsm-delays';

new FsmEffects(machine, {
  effects: {
    ...compileDelays({ delays: { ringing: { after: 30_000, send: { type: 'NO_ANSWER' } } } }),
    dialing: (snapshot, { signal, send }) => {
      // hand-written effect alongside the compiled delays
    },
  },
});
```

Merge per state: a delay map and an effect map that share a state key would overwrite on spread — keep their keys distinct unless you intend to override.

## Design decisions

- **Built on the effects runner.** A delay compiles to an effect that arms a timer on entry and returns `() => clearTimeout(handle)`. Cancellation, re-entrancy safety, and the guarded `send` all come from `@bazariodev/fsm-effects`. Because cleanup runs synchronously when the leaving state's controller aborts, **a pending timer can never fire for a state the machine has already left**.
- **`after` and `every`.** One-shot timeouts and repeating intervals, modelled as a union so a spec carries exactly one. `every` covers heartbeat and registration-refresh as first-class.
- **Dynamic resolvers.** `after`/`every`/`send` resolve against the entry snapshot — once when an `after` fires, on each tick for an `every`. Exponential backoff falls out of a dynamic `after` plus an attempt counter in `context`; no separate retry DSL.
- **Injectable scheduler.** An optional `scheduler` (`{ setTimeout, clearTimeout, setInterval, clearInterval }`) defaults to the global timers. Tests inject a deterministic clock instead of relying on fake timers.
- **Self-transitions don't restart timers** (inherited from the effects runner): a heartbeat `every` keeps ticking across the self-transitions its own events cause.
- **Validation.** Construction fails fast on a non-object `delays` map, a spec that is not an object, a spec without exactly one of `after`/`every`, a missing `send`, or a static `after`/`every` that is negative/non-finite (`after >= 0`, `every > 0`). A dynamic resolver that yields an invalid duration is logged at `warn` and skipped for that entry; the rest still arm.
- **Error containment.** The timer callback fires after the effect body returns, outside the runner's try/catch, so the module wraps it: a throw from resolving `send`, or a machine error from the delayed `api.send` (guard/reducer/hook failure), is caught and logged via `logger` as `fsm-delays: delayed send threw` rather than escaping as an uncaught timer exception. No error event is auto-sent.

## API

- `FsmDelays` — convenience runner that owns an internal `FsmEffects`; `stop()` and `[Symbol.dispose]`.
- `compileDelays(config)` — pure compiler returning an `EffectsConfig['effects']` fragment.
- Types: `AfterSpec`, `EverySpec`, `DelaySpec`, `DelaysConfig`, `Scheduler`, `Resolvable`.

## License

MIT
