# @bazariodev/fsm-delays

Timeouts and intervals for [`@bazariodev/fsm`](https://www.npmjs.com/package/@bazariodev/fsm)
states. A delay arms when its state is entered, sends an event when it fires, and is cancelled when
the state is left. Built on [`@bazariodev/fsm-effects`](https://www.npmjs.com/package/@bazariodev/fsm-effects).

## Install

```sh
pnpm add @bazariodev/fsm-delays @bazariodev/fsm @bazariodev/fsm-effects
```

`@bazariodev/fsm` and `@bazariodev/fsm-effects` are peer dependencies. FSM Delays 2.x needs FSM
Effects 2.x and FSM ^1.1.0; upgrade Delays and Effects together.

## Usage

```ts
import { FsmDelays } from '@bazariodev/fsm-delays';

// `callMachine` is your Fsm.
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
```

When you're done, call `delays.stop()`, or create the runner with `using` so it stops at the end of
the scope.

Each delay has exactly one of `after` or `every`, plus the event to `send`. A state can take an
array of delays, and delays under `*` apply to every state.

| Field | Meaning |
| --- | --- |
| `after` | Milliseconds (`>= 0`) until the event is sent once. A number, or a function of the entry snapshot. |
| `every` | Milliseconds (`> 0`) between repeated sends. A number, or a function of the entry snapshot. |
| `send` | The event, or a function of the entry snapshot that returns it. |
| `id` | Optional label added to this delay's log metadata. |

## Behavior

- A delay never sends its event after its state is left: leaving cancels the timer before the next
  state's effects run.
- Self-transitions don't restart timers. A heartbeat `every` keeps ticking across the
  self-transitions its own events cause, and an `after` keeps its original deadline.
- `after` and `every` functions run once, on state entry. A `send` function runs each time the
  delay fires. All of them receive the snapshot from state entry, so a self-transition doesn't
  refresh their `context`.
- Compute retry delays from context, for example with an attempt counter, as in the `reconnecting`
  example above.

## Using delays with your own effects

`compileDelays` turns delays into an effects map for your own `FsmEffects`, so one runner handles
both:

```ts
import { FsmEffects } from '@bazariodev/fsm-effects';
import { compileDelays, type DelaysConfig } from '@bazariodev/fsm-delays';

// `CallState`, `CallEvent`, and `CallContext` are your machine's types.
const callDelays: DelaysConfig<CallState, CallEvent, CallContext> = {
  delays: { ringing: { after: 30_000, send: { type: 'NO_ANSWER' } } },
};

new FsmEffects(machine, {
  effects: {
    ...compileDelays(callDelays),
    dialing: (snapshot, { signal, send }) => {
      // your own effect
    },
  },
});
```

In TypeScript, type the delays with your machine's types as above. Otherwise the state type is
inferred from the delay keys alone, and the result no longer fits your machine.

Keep the state names in the two maps distinct: when both maps have the same state, the spread keeps
only the later entry. If one state needs both a delay and an effect, run `FsmDelays` and
`FsmEffects` side by side on the same machine.

## Errors

- The constructor throws on an invalid config: `delays` isn't a plain object; a delay isn't a plain
  object (including `null`); a delay doesn't have exactly one of `after` and `every`; `send` is
  missing; or a fixed `after`/`every` isn't a finite number in range. A string such as `"100"` is
  rejected too. Delays fail inside timers, where errors are only logged, so without these checks a
  typo like `{ afer: 100 }` would never fire.
- If an `after`/`every` function returns an invalid duration, that delay is skipped and a warning is
  logged. If it throws, FSM Effects logs the error. Either way, the state's other delays still arm.
- If sending the delayed event throws (a throwing `send` function, or a guard, reducer, or hook
  error in the machine), the error is logged as `fsm-delays: delayed send threw`. No other event is
  sent.

## API

- `new FsmDelays(machine, { delays, scheduler?, logger? })`: runs the delays with an internal
  `FsmEffects`. `stop()` cancels pending timers and unsubscribes; `[Symbol.dispose]()` does the same.
- `compileDelays({ delays, scheduler?, logger? })`: returns an effects map for your own `FsmEffects`.
- `scheduler` replaces the global timers with your own `{ setTimeout, clearTimeout, setInterval,
  clearInterval }`. Inject a manual clock in tests instead of using fake timers.
- Types: `AfterSpec`, `EverySpec`, `DelaySpec`, `DelaysConfig`, `Scheduler`, `Resolvable`.

## TypeScript

Add `"DOM"` (browsers) or `"WebWorker"` (workers) to `compilerOptions.lib`, or use Node typings that
provide `AbortSignal` (FSM Effects needs it). Since 2.0 no DOM types are added for you; timer
behavior is unchanged.

## License

MIT
