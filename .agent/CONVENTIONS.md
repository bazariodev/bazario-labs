# Bazario Labs Conventions

This file captures implementation guidance for agents and contributors working in the Bazario Labs workspace.

## Package Design

- Build small, reusable SDK packages for UCaaS and realtime workflows.
- When designing abstractions, favor SOLID, separation of concerns, and inversion of control.
- Prefer smaller reusable modules over broad, tightly coupled implementations.
- Prefer dependency-light implementations unless a dependency clearly reduces maintenance cost.
- Write new abstractions in plain JavaScript and export runtime APIs from `src/index.js`.
- Keep TypeScript declarations in `src/index.d.ts` for the external consumer interface only.
- Keep implementations straightforward; add checks only for the documented contract and actual platform behavior.
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
- Name new behavioral test files `*.test.js`; existing TypeScript tests may remain unchanged.
- Test public interfaces and observable behavior only, never implementation details or private state.
- TypeScript consumer examples may verify public declarations, including rejected inputs.

## TypeScript and Build

- Use strict TypeScript settings for public declarations and consumer-interface tests.
- Do not add internal TypeScript types or JSDoc type annotations to new JavaScript implementations.
- Existing TypeScript packages may remain unchanged; avoid `any` in their code and public interfaces.
- Target modern JavaScript with `ES2022`.
- Use `NodeNext` module settings.
- Build packages with `tsup` and ship both ESM and CommonJS outputs.
- Preserve public declaration files and source maps for published packages; provide matching ESM and CommonJS declarations.
- SDK packages should remain tree-shakable through focused exports and side-effect-free design.

## Code Quality

- Use Biome for linting and formatting.
- Preserve the existing code style and keep changes focused.
- Avoid adding unnecessary abstractions or dependencies.
- Prefer straightforward control flow and predictable state transitions.
- Keep public interface types precise; use `unknown` for untrusted external values.

## Release Workflow

- Use Changesets for versioning and publishing.
- Workspace-wide commands are run from the repository root with `pnpm`.
- Validate the touched package with targeted tests before broader workspace checks.

## Current Package Notes

- `@bazariodev/fsm` is a dependency-free finite state machine package.
- The package is intended for telephony, SIP, chat, and other realtime workflow orchestration.
- Keep machine behavior synchronous; async work should stay outside the core state machine.
