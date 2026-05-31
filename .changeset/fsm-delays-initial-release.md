---
"@bazariodev/fsm-delays": minor
---

Initial release: declarative delays and intervals for `@bazariodev/fsm`, built on `@bazariodev/fsm-effects`. Supports one-shot `after` timeouts and repeating `every` intervals attached to states, with `after`/`every` and `send` as static values or functions of the entry snapshot (so exponential backoff falls out of a dynamic `after` plus a context attempt counter). Timers arm on state entry and are cancelled on leave, transition-out, or `stop()` — a pending timer can never fire for a state the machine has already left. Ships both a `compileDelays` primitive (returns an effects fragment to merge into your own `FsmEffects`) and an `FsmDelays` convenience runner, plus an injectable scheduler that defaults to the global timer functions.
