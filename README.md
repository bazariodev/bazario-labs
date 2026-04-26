# Bazario Labs

TypeScript SDKs and tools for the UCaaS domain — realtime, SIP, chat, and telephony.

## Packages

| Package | Description |
| --- | --- |
| [`@bazario/fsm`](./packages/fsm) | Lightweight, configurable TypeScript finite state machine for frontend runtimes, realtime clients, and telephony workflows. |

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
