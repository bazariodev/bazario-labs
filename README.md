# Bazario Labs

JavaScript building blocks for realtime connections, chat, and telephony, with TypeScript declarations.

## Packages

| Package | Description |
| --- | --- |
| [`@bazariodev/fsm`](./packages/fsm) | Lightweight, configurable finite state machine with TypeScript declarations for frontend runtimes, realtime clients, and telephony workflows. |
| [`@bazariodev/fsm-effects`](./packages/fsm-effects) | State-entry effects runner for `@bazariodev/fsm`: `AbortSignal` cancellation, cleanup, and a re-entrancy-safe guarded `send`. |
| [`@bazariodev/fsm-delays`](./packages/fsm-delays) | Declarative `after` timeouts and `every` intervals (with context-derived backoff) that arm on entry and cancel on leave, built on `@bazariodev/fsm-effects`. |
| [`@bazariodev/fsm-hierarchy`](./packages/fsm-hierarchy) | Hierarchical composition for `@bazariodev/fsm`: one child region per state, bubbling event routing, routed node handles, and composed snapshots. |
| [`@bazariodev/fsm-react`](./packages/fsm-react) | React bindings for FSM sources with `useSyncExternalStore`, selector bail-outs, and component-owned machine lifecycle helpers. |
| [`@bazariodev/fsm-persist`](./packages/fsm-persist) | Snapshot persistence for `@bazariodev/fsm`: write-through storage, versioned records, and rehydrate-by-construction helpers for flat machines and hierarchies. |
| [`@bazariodev/fsm-inspect`](./packages/fsm-inspect) | Dev-time inspection helpers for transition timelines, logger capture, source commit recording, and Mermaid diagram export. |
| [`@bazariodev/transport`](./packages/transport) | Shared transport contract and plain JavaScript WebSocket, streaming HTTP, and WebTransport adapters with bounded writes and disposal. |
| [`@bazariodev/idle-watchdog`](./packages/idle-watchdog) | Dependency-free, re-armable one-shot inactivity timer with explicit activity reporting, idle subscriptions, and disposal. |
| [`@bazariodev/keepalive`](./packages/keepalive) | Abortable promise probes with idle and response deadlines. |
| [`@bazariodev/coordination`](./packages/coordination) | FIFO Queue storage, task executors, typed event subscriptions, bounded jitter, and caller-owned backoff scheduling. |
| [`@bazariodev/rpc`](./packages/rpc) | Flat request and notification frames with bounded response correlation and cancellation. |
| [`@bazariodev/realtime`](./packages/realtime) | Injected client for connection readiness, attempt replacement, and recovery over opaque messages. |

Each package README covers installation and its API. Each package's `CHANGELOG.md` records its
releases and ships in the npm package. All packages ship ESM and CommonJS with matching `.d.ts` and
`.d.cts` declarations.

## TypeScript setup

FSM Effects, FSM Delays, Transport, Keepalive, Realtime, RPC, and Coordination use platform APIs such as `AbortSignal` but don't
add DOM types to your project. Add the library for your runtime to `compilerOptions.lib`: `"DOM"`
for browsers or `"WebWorker"` for workers, for example `["ES2022", "DOM"]`. On Node, use Node
typings that provide `AbortSignal`; Transport also needs declarations for WebTransport and the other
Web APIs in its interface. This changed in FSM Effects 2.0, FSM Delays 2.0, and Transport 0.2;
runtime behavior did not. Upgrade FSM Delays and FSM Effects together.

## Architecture

The current realtime design uses opaque messages and an optional `JsonTransport` codec. The root
factory selects lifecycle and retry defaults; the `/core` entry accepts injected dependencies without
importing those defaults. The root factory shares one coordination timer provider across connection
timeout, default retry, and default Keepalive. Keepalive runs an abortable probe only when configured.
RPC uses the RealtimeClient directly and sends flat request/result/error frames. The application owns
auth, online state, wake handling, readiness beyond transport open, and domain synchronization. See the
[current composition decision](./.agent/ADR/Modules/RealtimeComposition.md).

These guides are HTML pages. GitHub shows their source, so clone the repository and open them in a
browser:

- [Keepalive and RealtimeClient guide](./docs/keepalive-realtime-guide.html) — current ownership,
  timing scenarios, and integration examples.
- [Realtime client hierarchy](./docs/realtime-client-hierarchy.html) — current responsibility map.
  Historical decisions remain in the [Realtime ADR](./.agent/ADR/Modules/Realtime.md) and
  [RPC ADR](./.agent/ADR/Modules/Rpc.md); the [composition ADR](./.agent/ADR/Modules/RealtimeComposition.md)
  records the current design.

## Getting started

Requires Node.js >= 22 and pnpm >= 10. The workspace pins pnpm 10.33.2 in `package.json`.

```sh
pnpm install
pnpm build
pnpm test
```

## Development

| Command | Description |
| --- | --- |
| `pnpm build` | Build all packages |
| `pnpm test` | Build all packages, then run their tests |
| `pnpm tsc` | Build all packages, then type-check their public interfaces |
| `pnpm health` | Build once, then type-check, lint, and test all packages |
| `pnpm lint` | Lint with Biome |
| `pnpm lint:fix` | Lint and auto-fix |
| `pnpm format` | Format with Biome |
| `pnpm changeset` | Create a changeset for releasing |

Workspace imports resolve through each package's `dist` exports, so typechecks and tests need
the build output. The root commands above prepare it automatically, including on a fresh checkout.

To work on one package, build it together with its workspace dependencies (the trailing `...`),
then test and type-check it. Replace `keepalive` with the package you're working on:

```sh
pnpm --filter @bazariodev/keepalive... build
pnpm --filter @bazariodev/keepalive test
pnpm --filter @bazariodev/keepalive typecheck
```

`typecheck` compiles each package's public-interface examples, including inputs that must be
rejected. Packages that use platform APIs are checked against both the `DOM` and `WebWorker`
libraries.

## Releasing

Versioning and publishing use [Changesets](https://github.com/changesets/changesets).

1. `pnpm changeset`: describe the change. A docs-only change needs a patch changeset too, because
   npm shows the README of the latest published version
   ([npm docs](https://docs.npmjs.com/about-package-readme-files/)).
2. `pnpm version-packages`: bump versions and update changelogs.
3. `pnpm health`: validate the versioned workspace.
4. Commit the version bump.
5. `npm whoami --registry=https://registry.npmjs.org`: check that you're signed in to an account
   that can publish `@bazariodev` packages. If not, run
   `npm login --registry=https://registry.npmjs.org --auth-type=web` and finish signing in in the
   browser.
6. `pnpm release`: build and publish every workspace version that isn't on npm yet. Changesets
   creates a git tag for each published package.
7. `git push --follow-tags`: push the release commit and its tags.

## License

MIT — see [LICENSE](./LICENSE).
