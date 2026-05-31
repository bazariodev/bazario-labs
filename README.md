# Bazario Labs

TypeScript SDKs and tools for the UCaaS domain — realtime, SIP, chat, and telephony.

## Packages

| Package | Description |
| --- | --- |
| [`@bazariodev/fsm`](./packages/fsm) | Lightweight, configurable TypeScript finite state machine for frontend runtimes, realtime clients, and telephony workflows. |
| [`@bazariodev/fsm-effects`](./packages/fsm-effects) | State-entry effects runner for `@bazariodev/fsm`: `AbortSignal` cancellation, cleanup, and a re-entrancy-safe guarded `send`. |
| [`@bazariodev/fsm-delays`](./packages/fsm-delays) | Declarative `after` timeouts and `every` intervals (with context-derived backoff) that arm on entry and cancel on leave, built on `@bazariodev/fsm-effects`. |

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
