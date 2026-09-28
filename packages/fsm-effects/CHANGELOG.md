# @bazariodev/fsm-effects

## 2.0.1

### Patch Changes

- Rewrite the package README so it stands on its own: install steps with peer dependencies, a minimal
  example first, behavior as short rules, and option tables. Document behavior that was missing, such
  as effect ordering, hierarchy child re-creation and node paths, persistence options and restore
  order, and inspection entry types. Link related packages to their npm pages. Include `CHANGELOG.md`
  in the published package. In FSM Delays, correct the `Resolvable` doc comment. These documentation
  and packaging changes don't change runtime behavior or types.

## 2.0.0

### Major Changes

- a27d012: Stop forcing the DOM library into consumers through public declarations. Use the consumer's
  platform types so WebWorker projects compile without conflicting globals. Check both browser and
  Worker consumer interfaces with library checking enabled.

  This is a breaking type change for consumers that relied on the previous implicit DOM library.
  TypeScript consumers must include `DOM` or `WebWorker` in `compilerOptions.lib`, or supply equivalent
  platform declarations. Node projects using FSM Effects or FSM Delays need Node typings that provide `AbortSignal`;
  Node projects using Transport also need declarations for its exposed Web APIs, including WebTransport.
  Consumers already providing these types need no configuration change. Runtime behavior is unchanged.

  FSM Delays advances its FSM Effects peer dependency to the new major version.

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
