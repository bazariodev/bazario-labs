# Bazario Labs Conventions

This file captures implementation guidance for agents and contributors working in the Bazario Labs workspace.

## Package Design

- Build small, reusable TypeScript SDK packages for UCaaS and realtime workflows.
- When designing abstractions, favor SOLID, separation of concerns, and inversion of control.
- Prefer smaller reusable modules over broad, tightly coupled implementations.
- Prefer dependency-light implementations unless a dependency clearly reduces maintenance cost.
- Keep public APIs intentional and export them from `src/index.ts`.
- Design packages for frontend runtimes, Node-based tooling, and realtime communication clients.

## Repository Structure

- Monorepo packages live under `packages/<package-name>`.
- Runtime source files live under `packages/<package-name>/src`.
- Tests live under `packages/<package-name>/src/**/__tests__`.
- Every package should include a `README.md` with package details and usage examples.
- Keep package-specific docs in the package directory when needed.

## Testing

- Use Vitest for unit tests.
- Place test files in a `__tests__` folder for each package or module area.
- Name test files `*.test.ts`.
- Prefer tests that exercise public behavior rather than internal implementation details.

## TypeScript and Build

- Use strict TypeScript settings.
- Avoid both explicit `any` and implicit `any` in package code.
- Target modern JavaScript with `ES2022`.
- Use `NodeNext` module settings.
- Build packages with `tsup` and ship both ESM and CommonJS outputs.
- Preserve declaration files and source maps for published packages.
- SDK packages should remain tree-shakable through focused exports and side-effect-free design.

## Code Quality

- Use Biome for linting and formatting.
- Preserve the existing code style and keep changes focused.
- Avoid adding unnecessary abstractions or dependencies.
- Prefer explicit types and predictable state transitions.
- Do not rely on `any` as a shortcut when a concrete type, generic, or `unknown` is more accurate.

## Release Workflow

- Use Changesets for versioning and publishing.
- Workspace-wide commands are run from the repository root with `pnpm`.
- Validate the touched package with targeted tests before broader workspace checks.

## Current Package Notes

- `@bazariodev/fsm` is a dependency-free finite state machine package.
- The package is intended for telephony, SIP, chat, and other realtime workflow orchestration.
- Keep machine behavior synchronous; async work should stay outside the core state machine.