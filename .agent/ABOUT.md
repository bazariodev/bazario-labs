# About Bazario Labs

Bazario Labs is a pnpm workspace for TypeScript SDKs and developer tooling aimed at the UCaaS domain. The repository is positioned around realtime communications use cases such as SIP signaling, chat, telephony, and call-flow orchestration.

This workspace currently contains three packages:

- `@bazariodev/fsm`: a lightweight, configurable finite state machine library for frontend runtimes, realtime clients, and telephony workflows.
- `@bazariodev/fsm-effects`: a state-entry effects runner around `@bazariodev/fsm` with `AbortSignal` cancellation, cleanup, and a re-entrancy-safe guarded `send`.
- `@bazariodev/fsm-delays`: declarative `after` timeouts and `every` intervals (with context-derived backoff), built on `@bazariodev/fsm-effects`.

## Project Scope

The goal of the repository is to provide reusable SDK building blocks for communication-heavy products. The current FSM package is designed for cases where stateful flows need to stay predictable and typed, for example:

- call lifecycle management
- SIP session state transitions
- reconnect and retry flows
- chat or presence workflow orchestration
- other realtime client state machines

## Tech Stack

- Language: TypeScript
- Runtime target: Node.js 20+
- Package manager: pnpm
- Workspace model: pnpm monorepo
- Module output: ESM and CommonJS
- Type output: bundled `.d.ts` declarations
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
- `packages/*/src`: source code and types; `packages/*/src/__tests__`: package tests
- `.agent`: agent-facing project context and documentation

## Development Workflow

Common root commands:

- `pnpm build`: build all packages
- `pnpm test`: run package tests
- `pnpm typecheck`: run TypeScript checks across packages
- `pnpm lint`: run Biome checks
- `pnpm lint:fix`: apply Biome fixes
- `pnpm format`: format the codebase
- `pnpm changeset`: create a release changeset

Release flow:

1. Create a changeset.
2. Run `pnpm version-packages` to update versions and changelogs.
3. Run `pnpm release` to build and publish.

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
- Tests live under `src/**/__tests__/**/*.test.ts` for each package or module area.

## Summary

This repository is a TypeScript-first SDK workspace for UCaaS-related building blocks. Today it centers on a reusable FSM package, with supporting tooling for building, testing, linting, and publishing production-ready packages.