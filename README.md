# Bazario Labs

TypeScript SDKs and tools for the UCaaS domain — realtime, SIP, chat, and telephony.

## Packages

| Package | Description |
| --- | --- |
| [`@bazariodev/fsm`](./packages/fsm) | Lightweight, configurable TypeScript finite state machine for frontend runtimes, realtime clients, and telephony workflows. |
| [`@bazariodev/fsm-effects`](./packages/fsm-effects) | State-entry effects runner for `@bazariodev/fsm`: `AbortSignal` cancellation, cleanup, and a re-entrancy-safe guarded `send`. |
| [`@bazariodev/fsm-delays`](./packages/fsm-delays) | Declarative `after` timeouts and `every` intervals (with context-derived backoff) that arm on entry and cancel on leave, built on `@bazariodev/fsm-effects`. |
| [`@bazariodev/fsm-hierarchy`](./packages/fsm-hierarchy) | Hierarchical composition for `@bazariodev/fsm`: one child region per state, bubbling event routing, routed node handles, and composed snapshots. |
| [`@bazariodev/fsm-react`](./packages/fsm-react) | React bindings for FSM sources with `useSyncExternalStore`, selector bail-outs, and component-owned machine lifecycle helpers. |
| [`@bazariodev/fsm-persist`](./packages/fsm-persist) | Snapshot persistence for `@bazariodev/fsm`: write-through storage, versioned records, and rehydrate-by-construction helpers for flat machines and hierarchies. |
| [`@bazariodev/fsm-inspect`](./packages/fsm-inspect) | Dev-time inspection helpers for transition timelines, logger capture, source commit recording, and Mermaid diagram export. |
| [`@bazariodev/transport`](./packages/transport) | Shared transport contract and plain JavaScript WebSocket, streaming HTTP, and WebTransport adapters with bounded writes and disposal. |

## Architecture

- [Proposed R2 realtime client hierarchy](./docs/realtime-client-hierarchy.html) — module dependencies
  and responsibility boundaries for transport, realtime, RPC, auth, network recovery, and domains.

## Getting started

Requires Node.js >= 20 and pnpm >= 9.

```sh
pnpm install
pnpm build
pnpm test
```

## Development

| Command | Description |
| --- | --- |
| `pnpm build` | Build all packages |
| `pnpm test` | Run tests in all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint with Biome |
| `pnpm lint:fix` | Lint and auto-fix |
| `pnpm format` | Format with Biome |
| `pnpm changeset` | Create a changeset for releasing |

## Releasing

Versioning and publishing is handled by [Changesets](https://github.com/changesets/changesets).

```sh
pnpm changeset           # describe the change
pnpm version-packages    # bump versions + update changelogs
pnpm release             # build + publish to npm
```

## License

MIT — see [LICENSE](./LICENSE).
