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
- Every package includes a `README.md`; see Package READMEs below.
- Keep package-specific docs in the package directory when needed.

## Documentation and Code Comments

- Use only ASD-STE100 Simplified Technical English (STE) for all documentation and code comments.
- Follow the ASD-STE100 writing rules and approved vocabulary when you write or change this text.

## Package READMEs

npm shows each package's README on its own page, and npm readers may not be able to open repository
files. Every package README must stand on its own.

- Use this order: what the package does (one or two sentences), Install (with peer dependencies),
  Usage (the smallest real example), Behavior (rules a user can observe, as short bullets), API
  (options and methods tables), Errors, TypeScript, License. Package-specific topics go after Usage.
- Keep design rationale in the ADR, contributor commands in the root README, and planned features
  in the roadmap.
- Link other packages to their npm pages, not repository paths. Don't make an ADR or a source file
  the only place a rule is written down.
- In examples, say which helpers belong to the reader. Omit empty entries from `transitions`, but
  keep every state declared in `states`.
- Keep the first example to one task. Show more features, and shutdown calls such as `stop()`, in
  separate examples after it.
- A README-only change still needs a patch changeset: npm updates a package's README only when a new
  version is published.

## Testing

- Use Vitest for unit tests.
- Place test files in a `__tests__` folder for each package or module area.
- Name behavioral test files `*.test.js`.
- Test public interfaces and observable behavior only, never implementation details or private state.
- TypeScript consumer examples may verify public declarations, including rejected inputs.

## TypeScript and Build

- Use strict TypeScript settings for public declarations and consumer-interface tests.
- Do not add internal TypeScript types or JSDoc type annotations to new JavaScript implementations.
- Avoid `any` in code and public interfaces.
- Target modern JavaScript with `ES2022`.
- Use `NodeNext` module settings.
- Build packages with the shared Rollup script and ship both ESM and CommonJS outputs.
- Copy public declarations to matching ESM `.d.ts` and CommonJS `.d.cts` files.
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
