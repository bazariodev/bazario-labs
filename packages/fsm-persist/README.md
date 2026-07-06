# @bazariodev/fsm-persist

Persistence helpers for [`@bazariodev/fsm`](https://github.com/Bazariodev/bazario-labs/tree/main/packages/fsm) and hierarchy-shaped sources.

Full design rationale: [`Persist.md` ADR](https://github.com/Bazariodev/bazario-labs/blob/main/.agent/ADR/Modules/Persist.md).

```sh
pnpm add @bazariodev/fsm-persist @bazariodev/fsm
```

## Flat machines

```ts
import { Fsm } from '@bazariodev/fsm';
import { persistFsm, restoreFsmConfig } from '@bazariodev/fsm-persist';

const restored = restoreFsmConfig(callConfig, {
  storage: localStorage,
  key: 'call',
});

const machine = new Fsm(restored.config);
const persist = persistFsm(machine, {
  storage: localStorage,
  key: 'call',
  name: callConfig.name,
});
```

Restore is by construction: `restoreFsmConfig` returns a config whose `initial` and `context` come from storage when the record is valid. Construct the machine normally. A restored machine starts at `version: 0` and `previousValue: null`.

## Hierarchies

```ts
import { FsmHierarchy } from '@bazariodev/fsm-hierarchy';
import {
  persistHierarchy,
  restoreHierarchyConfig,
} from '@bazariodev/fsm-persist';

const restored = restoreHierarchyConfig(rootConfig, {
  storage: localStorage,
  key: 'call-tree',
});

const hierarchy = new FsmHierarchy(restored.config);
const persist = persistHierarchy(hierarchy, {
  storage: localStorage,
  key: 'call-tree',
  name: rootConfig.name,
});
```

Hierarchy restore walks the stored active spine top-down. If the root state no longer exists, nothing is restored. If a deeper level no longer matches the current config, the valid prefix restores and everything below it starts fresh at the declared `initial`.

## API

```ts
import type { FsmSubscribable } from '@bazariodev/fsm';

type PersistStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
```

`localStorage` and `sessionStorage` satisfy `PersistStorage` directly. The source port is structural and exported by `@bazariodev/fsm`; `Fsm`, `FsmHierarchy`, and hierarchy node handles satisfy it.

Writers:

- `persistFsm(source, options)`
- `persistHierarchy(source, options)`
- `new FsmPersist(source, toState, options)` for custom projected state

Readers:

- `loadRecord(options)` validates and returns the versioned envelope only
- `restoreFsmConfig(config, options)`
- `restoreHierarchyConfig(config, options)`

`FsmPersist` writes once at construction and then on each committed notification. `filter` gates all writes. `stop()` unsubscribes without removing the record; `clear()` removes the record without stopping.

## Recovery model

Only state-at-rest is persisted: active state value and context. Effects, timers, subscribers, and in-flight work are not persisted. After restore, state `onEnter` runs normally, and attaching effects or delays re-fires the restored state's effects. That re-entry is the recovery model.

Only recovery-safe states belong in persisted records. For flows that cannot be meaningfully re-entered after a reload, use `filter` or a custom `FsmPersist` projection to persist a safe restore point instead.

## Security

Persisted context is plaintext web storage. Credentials, tokens, and PII do not belong in persisted machine context. `filter` is not redaction: when a snapshot is filtered out, the previous record remains in storage. Keep secrets out of persisted context, project a reduced state with custom `toState` / `serialize`, and call `clear()` on logout.

## Error policy

Bad storage data never bricks startup. Missing, corrupt, stale, wrong-name, wrong-kind, and unknown-state records degrade to a fresh start and log through the injected `Logger`.

Write failures are contained too. A throwing `filter`, `toState`, `now`, `serialize`, `setItem`, or `removeItem` is logged and does not affect the machine.
