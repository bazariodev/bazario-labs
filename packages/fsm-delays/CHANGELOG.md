# @bazariodev/fsm-delays

## 1.1.0

### Minor Changes

- Simplify the delays module and move its implementation to plain JavaScript with a hand-written
  public `index.d.ts`, shipped as matching ESM `.d.ts` and CommonJS `.d.cts` declarations. Export
  names and timer behavior are unchanged.

  - The `delays` map must be a plain object. Arrays, `Map`s, and class instances now throw
    `fsm-delays: delays must be a plain object` (previously `delays must be an object`, and a `Map`
    was accepted and silently armed nothing).
  - A `null` or other falsy entry, or a spec that is a class instance, now throws
    `must be a delay spec` instead of being ignored or accepted. Only `undefined` means "no delays for
    this state".
  - A static `after`/`every` that is not a valid number (for example the string `"100"`) now throws at
    construction. Previously only numbers were checked, so such a delay silently never armed. Dynamic
    resolvers that return an invalid value are still logged at `warn` and skipped.
  - `compileDelays` returns a null-prototype effects map, so a state named `__proto__` works. Its
    arrays are no longer frozen.
  - `AfterSpec` and `EverySpec` declare `every?: never` and `after?: never`, so TypeScript rejects a
    spec with both, matching the runtime check.

## 1.0.0

### Patch Changes

- Updated dependencies
  - @bazariodev/fsm@1.0.0
  - @bazariodev/fsm-effects@1.0.0

## 0.1.0

### Minor Changes

- bed2eac: Initial release: declarative delays and intervals for `@bazariodev/fsm`, built on `@bazariodev/fsm-effects`. Supports one-shot `after` timeouts and repeating `every` intervals attached to states, with `after`/`every` and `send` as static values or functions of the entry snapshot (so exponential backoff falls out of a dynamic `after` plus a context attempt counter). Timers arm on state entry and are cancelled on leave, transition-out, or `stop()` — a pending timer can never fire for a state the machine has already left. Ships both a `compileDelays` primitive (returns an effects fragment to merge into your own `FsmEffects`) and an `FsmDelays` convenience runner, plus an injectable scheduler that defaults to the global timer functions.
