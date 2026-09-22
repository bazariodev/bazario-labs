# @bazariodev/fsm-effects

## 1.1.0

### Minor Changes

- Simplify the effects runner and move its implementation to plain JavaScript with a hand-written
  public `index.d.ts`, shipped as matching ESM `.d.ts` and CommonJS `.d.cts` declarations. Export
  names are unchanged.

  - Initial-state effects run through the same drain loop as transitions. When an initial effect
    sends synchronously, it now finishes and its cleanup runs before the entered state's effects
    (`a start → a end → a cleanup → b enter`). Previously the entered state's effects ran first,
    in the middle of the initial effect (`a start → b enter → a end → a cleanup`). This matches the
    existing rule for transitions: leaving-state cleanups finish before entered-state effects run.
  - A returned function is always treated as a cleanup, even if it also has a `then` property.
  - Validation: `effects` must be a plain object, and each entry must be a function or an array of
    functions. The per-index message for arrays was merged into the entry message.

## 1.0.0

### Patch Changes

- Updated dependencies
  - @bazariodev/fsm@1.0.0

## 0.1.0

### Minor Changes

- 3ec72f9: Initial release: state-entry effects runner for `@bazariodev/fsm`. Supports synchronous and async effect bodies, `AbortSignal` cancellation on state leave, optional cleanup callbacks, a guarded `send` for driving the machine from inside effects, wildcard (`*`) effects, initial-state effects, and explicit `stop()` / `[Symbol.dispose]`. Re-entrant `send()` calls from effects or cleanups are serialized through a single drain loop, so every leaving-state cleanup completes before any entered-state effect runs and synchronous cascades only spawn the resting state's effects.
