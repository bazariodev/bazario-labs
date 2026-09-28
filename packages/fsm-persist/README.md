# @bazariodev/fsm-persist

Saves the state of a [`@bazariodev/fsm`](https://www.npmjs.com/package/@bazariodev/fsm) machine or
an [`@bazariodev/fsm-hierarchy`](https://www.npmjs.com/package/@bazariodev/fsm-hierarchy) tree to
storage after every transition, and restores it on the next start, for example after a page refresh.

## Install

```sh
pnpm add @bazariodev/fsm-persist @bazariodev/fsm
```

`@bazariodev/fsm` is a peer dependency. To persist a hierarchy, also install
`@bazariodev/fsm-hierarchy`.

## Flat machines

```ts
import { Fsm } from '@bazariodev/fsm';
import { persistFsm, restoreFsmConfig } from '@bazariodev/fsm-persist';

// `callConfig` is your FsmConfig.
// 1. Restore first: the persister writes as soon as it's created.
const { config, restored } = restoreFsmConfig(callConfig, {
  storage: localStorage,
  key: 'call',
});

// 2. Construct the machine normally.
const machine = new Fsm(config);

// 3. Save after every transition.
const persist = persistFsm(machine, {
  storage: localStorage,
  key: 'call',
  name: callConfig.name,
});
```

Restore doesn't create the machine. `restoreFsmConfig` returns your config with `initial` and
`context` taken from storage when the saved record is valid; `restored` tells you whether it was.
The restored machine starts at `version: 0` with `previousValue: null`.

**Restore before you create the persister.** The persister writes immediately, so creating it first
replaces the saved record with the fresh machine's state.

## Hierarchies

```ts
import { FsmHierarchy } from '@bazariodev/fsm-hierarchy';
import { persistHierarchy, restoreHierarchyConfig } from '@bazariodev/fsm-persist';

// `rootConfig` is your hierarchy config.
const { config } = restoreHierarchyConfig(rootConfig, { storage: localStorage, key: 'call-tree' });
const hierarchy = new FsmHierarchy(config);
const persist = persistHierarchy(hierarchy, {
  storage: localStorage,
  key: 'call-tree',
  name: rootConfig.name,
});
```

The record holds the state and context of each active machine, from the root down, and restore
applies it level by level. If the root state no longer exists in the config, nothing is restored. If
a deeper level no longer matches, the levels above it are restored and the rest start fresh at their
`initial` state. The result reports `restoredLevels` and `recordLevels`.

## What gets saved and restored

- Only state at rest is saved: each machine's state and context. Effects, timers, subscribers, and
  in-flight work are not.
- After restore, the restored state's `onEnter` runs as usual, and attaching effects or delays runs
  its effects again. That re-entry is how the app recovers.
- Persist only states that are safe to enter again after a reload. For flows that aren't, use
  `filter` to skip those snapshots, or save a safe restore point with a custom `toState` (see
  Security).
- Every committed transition writes to storage right away; there's no debounce. For high-frequency
  changes, such as a heartbeat counter in context, skip writes with `filter` or save less with a
  custom `toState`.
- Restored `context` is used as is; its shape isn't checked. If your context shape changes between
  releases, validate it in `deserialize` and throw on old data: the record is then ignored and the
  machine starts fresh.

## Security

Persisted context is stored in plaintext. Keep credentials, tokens, and personal data out of it.

- `filter` isn't redaction: when it skips a snapshot, the previous record stays in storage.
- To save only part of the state, create an `FsmPersist` with your own `toState`. Restore replaces
  `context` entirely, so merge the saved fields back into your defaults:

  ```ts
  import { Fsm } from '@bazariodev/fsm';
  import { FsmPersist, restoreFsmConfig } from '@bazariodev/fsm-persist';

  const { config } = restoreFsmConfig(callConfig, { storage: localStorage, key: 'call' });
  const machine = new Fsm({ ...config, context: { ...callConfig.context, ...config.context } });

  // Save only the state and the attempt counter.
  new FsmPersist(
    machine,
    ({ value, context }) => ({ kind: 'fsm', value, context: { attempts: context.attempts } }),
    { storage: localStorage, key: 'call', name: callConfig.name },
  );
  ```

- Call `clear()` on logout. `stop()` stops writing but keeps the record.

## API

Writers, each returning an `FsmPersist`:

- `persistFsm(machine, options)`
- `persistHierarchy(hierarchy, options)`
- `new FsmPersist(source, toState, options)`: saves your own projection. `toState` returns
  `{ kind: 'fsm', value, context }` or `{ kind: 'hierarchy', spine: [{ value, context }, …] }`.

`FsmPersist` writes once when it's created, then after each commit. `stop()` stops writing and keeps
the record; `clear()` removes the record and keeps writing. `[Symbol.dispose]()` calls `stop()`.

| Write option | Meaning |
| --- | --- |
| `storage` | Object with `getItem`, `setItem`, and `removeItem`; `localStorage` and `sessionStorage` fit directly. |
| `key` | Storage key. |
| `name` | Saved in the record. Restore ignores records with a different name. |
| `filter` | Optional `(snapshot) => boolean`; return `false` to skip a write. |
| `serialize` | Optional; defaults to `JSON.stringify`. |
| `logger` | Optional; defaults to a no-op. |
| `now` | Optional clock for the record's `at` timestamp; defaults to `Date.now`. |

Readers:

- `restoreFsmConfig(config, options)` returns `{ config, restored }`.
- `restoreHierarchyConfig(config, options)` returns `{ config, restored, restoredLevels, recordLevels }`.
- `loadRecord(options)` returns the validated record, or `null`. It needs `name`.

| Read option | Meaning |
| --- | --- |
| `storage`, `key` | Where to read. |
| `name` | Expected record name; defaults to `config.name`. |
| `maxAgeMs` | Optional; ignore records older than this many milliseconds. |
| `deserialize` | Optional; defaults to `JSON.parse`. Throw to reject a record. |
| `logger` | Optional; defaults to a no-op. |
| `now` | Optional clock for `maxAgeMs`; defaults to `Date.now`. |

A saved record looks like this, which helps when writing a custom `serialize`/`deserialize` or
looking at storage:

```json
{ "format": 1, "name": "call", "at": 1790000000000, "state": { "kind": "fsm", "value": "dialing", "context": { "attempts": 1 } } }
```

## Errors

- Invalid options throw: a source without `subscribe`, a `toState` that isn't a function, storage
  missing a method, an empty `key` or `name`, a hook option that isn't a function, or a negative or
  non-finite `maxAgeMs`.
- Bad saved data never breaks startup. A missing, corrupt, expired, wrong-name, wrong-kind, or
  unknown-state record is ignored and logged, and the machine starts fresh.
- Write failures are contained: a throwing `filter`, `toState`, `now`, `serialize`, `setItem`, or
  `removeItem` is logged and doesn't affect the machine.

## License

MIT
