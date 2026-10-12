# About Bazario Labs

Bazario Labs is a pnpm workspace for JavaScript SDKs with TypeScript declarations, and developer tooling, aimed at the UCaaS domain. The repository is positioned around realtime communications use cases such as SIP signaling, chat, telephony, and call-flow orchestration.

This workspace currently contains thirteen packages:

- `@bazariodev/fsm`: a lightweight, configurable finite state machine library for frontend runtimes, realtime clients, and telephony workflows.
- `@bazariodev/fsm-effects`: a state-entry effects runner around `@bazariodev/fsm` with `AbortSignal` cancellation, cleanup, and a re-entrancy-safe guarded `send`.
- `@bazariodev/fsm-delays`: declarative `after` timeouts and `every` intervals (with context-derived backoff), built on `@bazariodev/fsm-effects`.
- `@bazariodev/fsm-hierarchy`: hierarchical composition for `@bazariodev/fsm` with one child region per state, bubbling event routing, routed node handles, and composed snapshots.
- `@bazariodev/fsm-react`: React bindings for FSM sources with `useSyncExternalStore`, selector subscriptions, and component-owned machine lifecycle helpers.
- `@bazariodev/fsm-persist`: snapshot persistence with versioned records and rehydrate-by-construction helpers.
- `@bazariodev/fsm-inspect`: dev-time transition timelines, logger capture, source recording, and Mermaid export.
- `@bazariodev/transport`: shared one-attempt transport contract and WebSocket, streaming HTTP, and WebTransport adapters with local write admission and disposal.
- `@bazariodev/idle-watchdog`: dependency-free one-shot inactivity timer with explicit arming, idle subscriptions, cancellation, and disposal.
- `@bazariodev/keepalive`: abortable promise probes with idle and response deadlines.
- `@bazariodev/coordination`: FIFO storage, serial task executors, typed event subscriptions,
  bounded jitter, a default timer provider, and backoff callback scheduling.
- `@bazariodev/realtime`: injected connection lifecycle and recovery over opaque messages; JSON is an opt-in transport codec.
- `@bazariodev/rpc`: flat request/result/error frames over RealtimeClient's message and snapshot subscriptions.

## Project Scope

The goal of the repository is to provide reusable SDK building blocks for communication-heavy products. The current FSM package is designed for cases where stateful flows need to stay predictable and typed, for example:

- call lifecycle management
- SIP session state transitions
- reconnect and retry flows
- chat or presence workflow orchestration
- other realtime client state machines

## Tech Stack

- Language: plain JavaScript implementations with TypeScript public declarations
- Runtime target: Node.js 22+
- Package manager: pnpm
- Workspace model: pnpm monorepo
- Module output: ESM and CommonJS
- Type output: copied `.d.ts` declarations
- Compiler target: ES2022
- TypeScript module mode: NodeNext

## Tooling

- Build: `tsup`
- Testing: `vitest`
- Linting and formatting: `Biome`
- Versioning and publishing: `Changesets`
- Source control: Git

## Repository Layout

- `packages/fsm`: finite state machine SDK package
- `packages/fsm-effects`: state-entry effects runner built on `@bazariodev/fsm`
- `packages/fsm-delays`: declarative delays/intervals built on `@bazariodev/fsm-effects`
- `packages/fsm-hierarchy`: nested machine composition built on `@bazariodev/fsm`
- `packages/fsm-react`: React bindings built on the workspace `snapshot`/`subscribe` observation port
- `packages/fsm-persist`: versioned FSM snapshot persistence and rehydration helpers
- `packages/fsm-inspect`: dev-time FSM timeline, logging, recording, and diagram helpers
- `packages/transport`: shared transport declarations and plain JavaScript WebSocket, HTTP, and WebTransport adapters
- `packages/idle-watchdog`: plain JavaScript inactivity timer with public declarations and manual-scheduler contract tests
- `packages/keepalive`: abortable generic probes with idle and response deadlines, with public declarations and contract tests
- `packages/coordination`: plain JavaScript FIFO Queue, SyncExecutor, AsyncExecutor, Emitter,
  createJitter, defaultScheduler, and createBackoffScheduler with public declarations
- `packages/rpc`: flat request/result/error frames, bounded correlation, notifications, and correlated probes over RealtimeClient subscriptions
- `packages/realtime`: plain JavaScript logical realtime client with opaque messages, an optional JSON codec, and transport-stub tests
- `examples/coordination`: private workspace example for the coordination primitives
- `packages/*/src`: source code and types; `packages/*/src/__tests__`: package tests
- `docs`: contributor-facing architecture and responsibility guides
- `.agent`: agent-facing project context and documentation

## Development Workflow

Common root commands:

- `pnpm build`: build all packages
- `pnpm test`: build all packages, then run package tests
- `pnpm tsc`: build all packages, then check their public TypeScript interfaces
- `pnpm health`: build once, then type-check, lint, and test all packages
- `pnpm lint`: run Biome checks
- `pnpm lint:fix`: apply Biome fixes
- `pnpm format`: format the codebase
- `pnpm changeset`: create a release changeset

Release flow:

1. Create a changeset (README-only changes need a patch changeset too).
2. Run `pnpm version-packages` to update versions and changelogs.
3. Run `pnpm health`, then commit the version bump.
4. Run `pnpm release` to build and publish.
5. Run `git push --follow-tags` to push the release commit and its tags.

The root `README.md` has the full steps, including the npm sign-in check.

## Package Notes

The `@bazariodev/fsm` package is intentionally small and dependency-free. It ships:

- typed machine configuration
- guarded transitions
- entry, exit, and transition actions
- subscriptions for state updates
- ESM, CJS, source maps, and declaration files

## Engineering Conventions

- Strict TypeScript configuration is enabled.
- Output targets modern JavaScript (`ES2022`).
- The package is published as side-effect free.
- Biome is the single formatter and linter.
- Behavioral tests live under `src/**/__tests__/**/*.test.js`.
- Types describe public interfaces only; implementation details remain plain JavaScript.

## Summary

This repository is a typed SDK workspace for UCaaS-related building blocks. It contains the FSM
family, transport adapters, an idle watchdog, Keepalive, coordination primitives (including bounded
jitter, timer operations, and backoff scheduling), RealtimeClient, and RpcClient. The workspace has
build, test, lint, and release tooling.
