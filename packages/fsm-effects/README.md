# @bazariodev/fsm-effects

Effects runner for [`@bazariodev/fsm`](https://github.com/Bazariodev/bazario-labs/tree/main/packages/fsm). Runs declarative state-entry effects with `AbortSignal` cancellation, sync or async bodies, optional cleanup callbacks, and a guarded `send` for driving the machine from inside an effect.

Full design rationale: [`Effects.md` ADR](https://github.com/Bazariodev/bazario-labs/blob/main/.agent/ADR/Modules/Effects.md).

## Install

```sh
pnpm add @bazariodev/fsm-effects @bazariodev/fsm
```

`@bazariodev/fsm` is a peer dependency.

## Usage

```ts
import { FsmEffects } from '@bazariodev/fsm-effects';

const effects = new FsmEffects(callMachine, {
  effects: {
    // sync body + cleanup: cleanup runs when the state is left
    ringing: () => {
      const tone = startRingback();
      return () => tone.stop();
    },
    // async body: abort the work when the state is left via `signal`
    dialing: async (snapshot, { signal, send }) => {
      const res = await fetch('/invite', { signal });
      send(res.ok ? { type: 'ANSWERED' } : { type: 'FAILED' });
    },
    // interval driven by `send`; cleanup clears it on leave
    connected: (snapshot, { send }) => {
      const id = setInterval(() => send({ type: 'PING' }), 5_000);
      return () => clearInterval(id);
    },
    // wildcard runs on every entry, after the state-specific effects
    '*': (snapshot) => log(snapshot.value),
  },
});

effects.stop(); // or `using effects = new FsmEffects(...)`
```

An effect gets the committed `snapshot` and `{ signal, send }`. Return nothing, a cleanup function, or a promise of either. Multiple effects per state run in declaration order; state-specific effects run before `*`.

## Design decisions

- **Composition, not core.** The runner is a `subscribe` consumer — it never touches machine internals. The base core stays synchronous and effect-free, and effect bugs can't corrupt machine state.
- **State-entry only (v1).** Effects attach to states, not transitions. Need transition awareness? Read `snapshot.previousValue` inside the effect.
- **Cancellation.** One `AbortController` per active state. Leaving the state (or `stop()`) aborts its `signal`. A returned sync cleanup runs on abort; an async cleanup runs when its promise settles, even if abort already fired.
- **Guarded `send`.** `api.send` no-ops once the signal is aborted, so effects needn't guard every call site. Machine errors raised by `send` surface at the effect's call site; if uncaught they're contained like any effect throw (logged, runner survives). No error event is auto-sent.

### Re-entrancy: the drain loop

A `send()` from inside an effect or a cleanup runs synchronously, so it can re-enter the runner before the current transition's work is done. The runner serializes all of it through a single drain loop: a nested `send()` only records the latest target and returns; the active loop owns every controller swap and spawn. This guarantees:

- **all leaving-state cleanups finish before any entered-state effect runs** — they never interleave;
- **pass-through states are skipped** — in a synchronous `A → B → C` cascade only the resting state's (`C`) effects spawn;
- **stale callbacks are dropped** via a monotonic version guard.

Self-transitions (`A → A`) don't restart effects. They're detected by comparing the incoming snapshot's value against `#processedState`, a notification tracker updated when each non-self snapshot is observed — kept deliberately separate from the per-turn `AbortController`, so the provisional controller swap never influences a self-transition decision.

### Error policy

- sync throw from an effect → logged at `error`, contained, siblings still run;
- async rejection → `error`, or `debug` if the signal already aborted (e.g. a wrapped `fetch` `AbortError`);
- cleanup throw → logged, doesn't block other cleanups;
- nothing is auto-sent — `send({ type: 'EFFECT_FAILED' })` from your own `catch` if you want that.

### `stop()`

Aborts the current controller (running its cleanups), unsubscribes, and ignores later transitions. Idempotent. `[Symbol.dispose]` aliases it for `using`.

## License

MIT
