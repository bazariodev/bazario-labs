---
"@bazariodev/fsm-effects": minor
---

Initial release: state-entry effects runner for `@bazariodev/fsm`. Supports synchronous and async effect bodies, `AbortSignal` cancellation on state leave, optional cleanup callbacks, a guarded `send` for driving the machine from inside effects, wildcard (`*`) effects, initial-state effects, and explicit `stop()` / `[Symbol.dispose]`. Re-entrant `send()` calls from effects or cleanups are serialized through a single drain loop, so every leaving-state cleanup completes before any entered-state effect runs and synchronous cascades only spawn the resting state's effects.
