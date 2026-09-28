# @bazariodev/fsm-effects

Runs work when a [`@bazariodev/fsm`](https://www.npmjs.com/package/@bazariodev/fsm) machine enters
a state and cancels it when the machine leaves. Effects can be sync or async, receive an
`AbortSignal`, may return a cleanup, and can drive the machine through a guarded `send`. The runner
uses only the machine's public API, so a failing effect can't corrupt machine state.

## Install

```sh
pnpm add @bazariodev/fsm-effects @bazariodev/fsm
```

`@bazariodev/fsm` is a peer dependency.

## Usage

```ts
import { FsmEffects } from '@bazariodev/fsm-effects';

// `callMachine` is your Fsm; `startRingback` is your own helper.
const effects = new FsmEffects(callMachine, {
  effects: {
    // sync body + cleanup: the cleanup runs when the state is left
    ringing: () => {
      const tone = startRingback();
      return () => tone.stop();
    },
    // async body: `signal` aborts when the state is left
    dialing: async (snapshot, { signal, send }) => {
      const res = await fetch('/invite', { signal });
      send(res.ok ? { type: 'ANSWERED' } : { type: 'FAILED' });
    },
  },
});
```

An effect receives the committed `snapshot` and `{ signal, send }`. It may return nothing, a
cleanup function, or a promise of either. A state can take an array of effects, and effects under
`*` run on every state entry:

```ts
// in `effects`:
'*': (snapshot) => console.log('entered', snapshot.value),
```

When you're done, call `effects.stop()`, or create the runner with `using` so it stops at the end
of the scope. For timeouts and intervals,
[`@bazariodev/fsm-delays`](https://www.npmjs.com/package/@bazariodev/fsm-delays) does the same work
declaratively.

## Behavior

- Construction runs the current state's effects right away.
- A state's effects run in declaration order, then the `*` effects.
- Effects run on state entry only. A self-transition (`A → A`) keeps them running. Read
  `snapshot.previousValue` if an effect needs to know where the machine came from.
- Leaving the state, or calling `stop()`, aborts its `signal` and runs its cleanups. A cleanup
  returned by an async effect runs when the state is left, or right away if the state was already
  left when the promise resolved.
- `send` does nothing once `signal` is aborted, so a late callback can't drive the machine through
  it.
- If an effect's synchronous `send` moves the machine to another state, the remaining effects of
  that entry, including `*`, don't run.
- The old state's cleanups finish before the new state's effects start, even when an effect or
  cleanup sends synchronously.
- A state that the machine leaves before its effects start never runs them. For example, if a
  cleanup of `A` moves the machine from `B` on to `C`, `B`'s effects are skipped. A chain driven by
  effects still runs each state's effects: `A`'s effect sends to `B`, `B`'s effect sends to `C`.

## Errors

- A throwing effect is logged at `error`; the state's other effects still run.
- A rejected async effect is logged at `error`, or at `debug` if its signal was already aborted
  (for example an aborted `fetch`).
- A throwing cleanup is logged and doesn't block other cleanups.
- A machine error from `send` (guard, reducer, or hook) is thrown where your effect calls `send`.
  If you don't catch it, it's logged like any other effect error.
- Nothing is sent automatically on failure. Catch the error and send your own event, such as
  `{ type: 'EFFECT_FAILED' }`, if you need one.
- The constructor throws if `effects` isn't a plain object, or if an entry isn't a function or an
  array of functions. Effect errors are only logged, so this catches a misconfigured effect up front.

## API

- `new FsmEffects(machine, { effects, logger? })`: `machine` is any `FsmCore`, such as an `Fsm` or
  a hierarchy node handle; `logger` defaults to a no-op.
- `stop()`: abort the current state's effects, run their cleanups, and unsubscribe. The machine
  itself keeps running. Idempotent; `[Symbol.dispose]()` does the same for `using`.
- Types: `Effect`, `EffectApi`, `EffectCleanup`, `EffectsConfig`.

## TypeScript

Add `"DOM"` (browsers) or `"WebWorker"` (workers) to `compilerOptions.lib`, or use Node typings that
provide `AbortSignal`. Since 2.0 the package no longer adds DOM types for you; runtime behavior is
unchanged. Use FSM Delays 2.x with FSM Effects 2.x.

## License

MIT
