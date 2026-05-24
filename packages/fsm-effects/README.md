# @bazariodev/fsm-effects

Effects runner for [`@bazariodev/fsm`](../fsm). Declarative state-entry effects with `AbortSignal` cancellation, synchronous or async bodies, optional cleanup callbacks, and a guarded `send` for driving the machine from inside effect bodies.

## Status

In development. The design is captured in [`.agent/ADR/Modules/Effects.md`](../../.agent/ADR/Modules/Effects.md). API and runtime semantics will land before the first published version.

## Install

```sh
pnpm add @bazariodev/fsm-effects @bazariodev/fsm
```

`@bazariodev/fsm` is a peer dependency.

## License

MIT
