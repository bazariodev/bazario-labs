# ADR: FSM Persist Module

- Status: Accepted
- Date: 2026-07-05
- Accepted: 2026-07-05

## Context

Machines are in-memory: a page refresh resets every flow to its initial state. The UCaaS MVP checklist requires "session survives page refresh" (`ROADMAP.md`), and two shipped ADRs already point here:

- `Modules/Effects.md`: "a persistence story (a separate module can snapshot machine state and rehydrate; in-flight effects are *not* persistable by design)"
- `Modules/Hierarchy.md`: "persistence/rehydration of a running tree (composes with a future persistence module)"

Everything needed already exists as public seams: the core's stable `snapshot` accessor and post-commit `subscribe` (`Base/CoreFSM.md` §2, §8), caller-supplied `initial`/`context` in every config, the hierarchy's composed recursive snapshot, and the structural observation port proven by `fsm-react` (`Modules/React.md`, decision 2).

## Decision

We will build `@bazariodev/fsm-persist` as two thin layers over public seams, with **no core changes**. Because `fsm-persist` is the second consumer of the observation port, `fsm-react`'s exported `FsmSubscribable` type is aligned to the same zero-argument listener shape while both packages are still pre-1.0; existing `Fsm`, `FsmHierarchy`, and node-handle sources continue to satisfy the shape structurally.

- a **write side**: a persistor that subscribes to any snapshot source through the structural port and writes a versioned record to an injected storage on every committed transition
- a **read side**: pure functions that load a record and **rehydrate by construction** — returning a rewritten config (`initial` and `context` overridden from the record) that the consumer passes to the normal `Fsm` / `FsmHierarchy` constructor

Hierarchy rehydration is a config-tree transform: walk the stored active spine top-down, overriding each level's `initial`/`context` where valid; below the first mismatch, children start fresh at their declared `initial` — which is exactly the hierarchy's fresh re-entry doctrine applied to restore.

## Resolved decisions

These were open at drafting time and have been settled:

1. **State-at-rest only; recovery means re-entering.** Persisted state is `(value, context)` per machine (per level, for hierarchy). In-flight effects and timers are never persisted — both prior ADRs already commit to that. Restoration constructs a machine whose restored state is entered normally (initial `onEnter` runs with `from: null`, `event: null`, per core construction semantics), and attaching `FsmEffects`/`FsmDelays` afterwards re-fires the restored state's effects. Re-running entry effects **is** the recovery model, not a side effect to hide. The README must also state that only recovery-safe states belong in persistence: a flow that cannot be meaningfully re-entered after a reload (a mid-call state, an in-flight handshake) should `filter` to, or be projected onto, a safe restore point instead.
2. **Rehydrate-by-construction via pure config rewrite.** No `Fsm.restore()` API, no core changes: restore returns a new config object with `initial`/`context` replaced. Runtime bookkeeping is per-process — a restored machine starts at `version 0`, `previousValue: null` (and a restored hierarchy at `treeVersion 0`); consumers must not treat these as continuations.
3. **Untrusted-storage doctrine: the read side never throws.** Storage content — and the storage itself — is untrusted input. A throwing `getItem` (storage denied), corrupt, wrong-format, wrong-name, wrong-kind, stale (`maxAgeMs`), or unknown-state data all degrade to a fresh start: storage failures log at `error`, present-but-invalid records at `warn`, and a simply absent record (first launch, the normal case) at `debug` only. A refresh-survival feature that can brick startup on bad data is worse than no feature. Restore granularity is entry-point-specific: flat restore is all-or-nothing, and a hierarchy spine whose **root** level is invalid restores nothing — but a mismatch **deeper** in the spine truncates rather than discards: the valid prefix restores and levels below start fresh (see Rules).
4. **Sync storage port, localStorage-shaped.** `PersistStorage` is `{ getItem, setItem, removeItem }` over strings, so `localStorage`/`sessionStorage` pass directly and tests inject a memory stub. Write-through on every commit needs no unload flushing. Async storage (IndexedDB) is a deferred adapter concern.
5. **Structural typing throughout; no new peers.** The source port is the same `FsmSubscribable<TSnapshot>` name and zero-argument listener shape used by `fsm-react`: `snapshot` + `subscribe(listener: () => void)`. The hierarchy snapshot/config shapes are declared structurally in this package, mirroring the `fsm-react` precedent. `@bazariodev/fsm` stays a types-only peer (`FsmSnapshot`, `FsmConfig`, `Logger`); `fsm-hierarchy` is **not** a peer. Promoting the shared port type into the core is a candidate chore for the 1.0 freeze, tracked in the roadmap, not decided here.
6. **Write-through with a `filter` valve; no debouncing in v1.** Every committed transition serializes and writes. High-frequency flows (heartbeat ticks bumping context) are expected to throttle via `filter: (snapshot) => boolean` or to project a reduced persisted shape through a custom `toState` on the `FsmPersist` class — the README states this expectation explicitly. A time-based debounce would add timer machinery and a flush-on-unload problem for marginal benefit.
7. **Versioned envelope, no migration DSL.** Records carry `format: 1`, the machine `name`, and an `at` timestamp. Format or name mismatch → fresh start. Consumer-side data evolution goes through the `serialize`/`deserialize` overrides; a migration framework is backlog until a real second format exists.

## Scope

### In scope for v1

- `FsmPersist` writer: subscribe → serialize → `setItem` on every commit, `filter` support, `clear()`, `stop()` / `[Symbol.dispose]`
- `persistFsm` / `persistHierarchy` entry points (flat and spine payload codecs)
- `loadRecord`, `restoreFsmConfig`, `restoreHierarchyConfig` pure read-side functions
- record envelope: `format` / `name` / `at` + payload; `maxAgeMs` staleness check with injectable `now`
- `serialize`/`deserialize` overrides (default `JSON.stringify`/`JSON.parse`)
- error containment through the workspace `Logger` interface (no-op default)

### Out of scope for v1

- async storage backends (IndexedDB adapter package later)
- cross-tab synchronization / `storage` event handling (last-write-wins is documented; a tab-sync module is backlog)
- debounced or batched writes
- schema migration tooling
- encryption at rest (see Security)
- persisting in-flight effects, timers, or subscriber state (impossible by design)
- history beyond the single latest record per key

## Contracts

```ts
type PersistStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

// Structural source port. The listener is deliberately zero-argument: a
// notification is only a change signal and the writer reads source.snapshot.
// Existing sources (Fsm, FsmHierarchy, node handles) satisfy this shape as-is,
// because a listener taking fewer parameters is always assignable to theirs.
type FsmSubscribable<TSnapshot> = Readonly<{
  snapshot: TSnapshot;
  subscribe: (listener: () => void) => () => void;
}>;

type PersistedFsmState = Readonly<{ kind: 'fsm'; value: string; context: unknown }>;
type PersistedHierarchyState = Readonly<{
  kind: 'hierarchy';
  spine: ReadonlyArray<Readonly<{ value: string; context: unknown }>>;
}>;

type PersistRecord = Readonly<{
  format: 1;
  name: string;
  at: number;
  state: PersistedFsmState | PersistedHierarchyState;
}>;

type PersistOptions<TSnapshot> = Readonly<{
  storage: PersistStorage;
  key: string;
  name: string;
  filter?: (snapshot: TSnapshot) => boolean;
  serialize?: (record: PersistRecord) => string;
  logger?: Logger;
  now?: () => number;
}>;

class FsmPersist<TSnapshot> {
  constructor(
    source: FsmSubscribable<TSnapshot>,
    toState: (snapshot: TSnapshot) => PersistedFsmState | PersistedHierarchyState,
    options: PersistOptions<TSnapshot>,
  );
  clear(): void;
  stop(): void;
  [Symbol.dispose](): void;
}

function persistFsm<TState extends string, TContext>(
  source: FsmSubscribable<FsmSnapshot<TState, TContext>>,
  options: PersistOptions<FsmSnapshot<TState, TContext>>,
): FsmPersist<FsmSnapshot<TState, TContext>>;

function persistHierarchy(
  source: FsmSubscribable<HierarchySnapshotLike>,
  options: PersistOptions<HierarchySnapshotLike>,
): FsmPersist<HierarchySnapshotLike>;

type RestoreOptions = Readonly<{
  storage: PersistStorage;
  key: string;
  name?: string;          // defaults to config.name
  maxAgeMs?: number;
  deserialize?: (raw: string) => unknown;
  logger?: Logger;
  now?: () => number;
}>;

function loadRecord(options: RestoreOptions & { name: string }): PersistRecord | null;

function restoreFsmConfig<TState extends string, TEvent extends FsmEvent, TContext>(
  config: FsmConfig<TState, TEvent, TContext>,
  options: RestoreOptions,
): Readonly<{ config: FsmConfig<TState, TEvent, TContext>; restored: boolean }>;

function restoreHierarchyConfig(
  config: HierarchyConfigLike,
  options: RestoreOptions,
): Readonly<{
  config: HierarchyConfigLike;
  restored: boolean;      // true when at least the root level applied
  restoredLevels: number; // spine levels applied (0 when restored is false)
  recordLevels: number;   // spine levels present in the record
}>;
```

`HierarchySnapshotLike` / `HierarchyConfigLike` are structural declarations of the shapes `fsm-hierarchy` exports (`root` chain of `{ value, context, child }`; config with `name`/`initial`/`context`/`states`/`children`), so the real types satisfy them without an import.

## Rules

Write side:

- the persistor attempts one write at construction (so a machine that never transitions is still restorable) and one per subsequent notification; **every** write, including the construction write, runs the same pipeline: `filter` → `toState` → `now` (for `at`) → `serialize` → `setItem`
- the writer never relies on the subscriber callback's payload: a notification is only a change signal, and the writer reads `source.snapshot` — keeping the structural port's contract minimal (snapshot + change notification), exactly as `fsm-react` consumes it. A write is skipped when the snapshot reference equals the last successfully written one, which also dedupes nested notification cascades
- `filter` gates writes; when it returns `false` nothing is written and the previous record remains (documented consequence: a filtered-out final state restores to the last unfiltered one)
- the spine codec walks `snapshot.root` → `child` collecting `{ value, context }` per level; the flat codec takes `{ value, context }` from the snapshot. Hand-rolled structural sources are still untrusted at runtime: a cycle or excessive depth in the hierarchy snapshot throws inside the write pipeline and is logged as a contained write failure
- `stop()` unsubscribes and stops writing; it does not remove the record. `clear()` removes the record and does not stop. Both are idempotent
- a throw from **any** write-pipeline stage — `filter`, `toState`, `now`, `serialize`, or `setItem` (quota exceeded, Safari private mode, circular context) — is caught and logged at `error`; the machine is never affected, and neither the constructor nor the subscriber callback ever propagates a persistence failure. The constructor throws only for malformed options (see Validation)
- a `removeItem` throw inside `clear()` is likewise caught and logged at `error`

Read side:

- validation is two-staged, and each stage owns only what it can see. **`loadRecord` is envelope-only**: `storage.getItem` succeeds (a throw — storage denied — degrades to fresh start, logged at `error`) → raw present (absence is the normal first launch: fresh start, logged at `debug`, never `warn`) → `deserialize` succeeds → envelope shape valid, including `state` matching one of the two known payload shapes → `format === 1` → `name` matches → `at` within `maxAgeMs` (when given). Envelope probing itself is contained and copied into a plain record, so a custom `deserialize` returning a Proxy/lazy object with throwing getters degrades to `invalidRecord` instead of throwing. **The entry points own the rest**: `restoreFsmConfig` requires `state.kind === 'fsm'` and `restoreHierarchyConfig` requires `'hierarchy'` (a key shared across machine kinds must never cross-apply), then each validates state values against the config via `Object.hasOwn` per workspace convention. Any failure after the absence check → no restore + `warn` log, with the granularity defined below
- flat restore is **all-or-nothing**: an unknown `value` restores nothing; otherwise the returned config is `{ ...config, initial: record.state.value, context: record.state.context }`. The original config object is never mutated
- hierarchy restore walks the stored spine against the config tree top-down: level N's `value` must be a declared state of that level's config; if a next spine entry exists, the current level must declare a child under that state. Each valid level gets `initial`/`context` overridden; at the first invalid level the walk stops and everything below starts fresh — a valid prefix restores, the rest follows fresh re-entry. An invalid **root** level restores nothing (`restored: false`, `restoredLevels: 0`); a deeper mismatch is a **partial restore**: `restored: true` with `restoredLevels < recordLevels`, and the truncation is logged at `warn` with both counts so config evolution stays visible in the field
- `context` payloads are trusted after `deserialize`: the module cannot validate consumer context shapes. Consumers needing validation wrap `deserialize` (e.g. schema-check there and throw — a deserialize throw degrades to fresh start by rule 3)

## Composition (the R1 stack, end to end)

```ts
const { config, restored } = restoreFsmConfig(callConfig, { storage: localStorage, key: 'call' });
const machine = new Fsm(config);                    // restored state entered normally
const effects = new FsmEffects(machine, callEffects); // restored state's effects fire — recovery
const persist = persistFsm(machine, { storage: localStorage, key: 'call', name: callConfig.name });
```

With `fsm-react`, `restoreFsmConfig` + `new Fsm` live in `useFsm`'s `create` (reading storage is idempotent and discard-safe under StrictMode's double-invoked initializer), and the persistor belongs in `attach`, whose cleanup calls `persist.stop()` — writes are effect-scoped, reads are not.

## Error policy

- write-pipeline failures (`filter`, `toState`, `now`, `serialize`, `setItem`) and `clear()`'s `removeItem`: caught, logged `error`, machine unaffected; never propagated from the constructor or a subscriber callback
- read side never throws: `getItem` or injected `now` failure → fresh start logged `error`; present-but-invalid/stale/kind-mismatched record → fresh start logged `warn`; absent record → fresh start logged `debug`; a partial hierarchy restore logs its truncation at `warn`
- consumer errors unrelated to stored data (invalid base config) still throw from the core constructor as usual — this module does not wrap construction

## Security

Persisted context lands in plaintext web storage. Credentials, tokens, and PII do not belong in machine context that gets persisted — token lifetime is `auth-session`'s job (R2) with its own storage policy. Note that `filter` is **not** a redaction control: a filtered-out snapshot leaves the previous record in storage untouched. The real controls are keeping secrets out of persisted context in the first place, projecting a reduced shape through a custom `toState`/`serialize`, and calling `clear()` on logout — `stop()` deliberately does not remove the record. The README carries all of this prominently.

## Validation

Constructor fails fast for: malformed `source` (`subscribe` must be a function), non-function `toState`, missing/malformed `storage` (three functions), empty `key`/`name`, non-function `filter`/`serialize`/`now` when provided. The read-side functions apply the same doctrine to their own options: `maxAgeMs`, when provided, must be a finite number `>= 0` (`NaN`, negative, or infinite values throw rather than silently distorting expiry), and malformed reader options (`storage`, `key`, `name`, `deserialize`, `now`) throw programmer errors. The boundary is: **caller options are trusted input and fail fast; storage content is untrusted and never throws.** Runtime throws from a *valid* `toState` remain contained as write-pipeline failures. Diagnostic strings live in `internal/messages.ts` per workspace convention.

## Packaging

- new package `@bazariodev/fsm-persist`; peer: `@bazariodev/fsm` (current major, types only). No other peers — hierarchy shapes are structural; `@bazariodev/fsm-hierarchy` is a **devDependency** so compatibility tests exercise the real exported types against the structural declarations (the `fsm-react` precedent)
- same tooling (tsup, vitest, Biome), `internal/messages.ts` + `internal/predicates.ts`, own README + LICENSE, changeset at `0.1.0`
- node test environment (no DOM needed; storage is injected)

## Consequences

Positive:

- page-refresh survival for both flat machines and hierarchies with no core/runtime source changes
- the structural port gains its second consumer, hardening it as the platform observation contract
- restore semantics fall out of existing doctrines (construction entry, fresh re-entry) instead of inventing new ones
- pure read side and injected storage/clock make the module fully deterministic under test

Tradeoffs:

- version counters reset on restore — consumers diffing versions across reloads will be surprised (documented)
- write-through can be chatty for high-frequency context updates; `filter` is manual
- last-write-wins across tabs until a tab-sync module exists
- structural hierarchy types must track `fsm-hierarchy`'s shapes; the dev-dependency compatibility tests turn a breaking shape change there into a compile/test failure here, but only when this package rebuilds — not automatically at the source

## Next steps

1. Scaffold `packages/fsm-persist/` (peer `@bazariodev/fsm`, tsconfig, tsup, vitest node env, README with the security warning, LICENSE).
2. Types + `internal/messages.ts` / `internal/predicates.ts`; memory-storage test stub.
3. Implement the record codec + read side (`loadRecord`, `restoreFsmConfig`, `restoreHierarchyConfig`), then the writer (`FsmPersist`, `persistFsm`, `persistHierarchy`).
4. Tests: initial write at construction, gated by `filter` like any other write; write per commit; writer reads `source.snapshot` on notification (callback payload ignored) and skips duplicate snapshot references; `filter` suppresses writes and restore returns the last unfiltered state; `filter`/`toState`/`serialize` throws contained — write skipped, logged at `error`, machine keeps transitioning; cyclic/excessively deep hand-rolled hierarchy snapshots are contained write failures; `setItem` quota throw contained + logged; `stop()` halts writes without removing; `clear()` removes without stopping; `removeItem` throw in `clear()` contained; all idempotent; read side: `getItem` throw → fresh start logged `error`, never throws; custom `deserialize` returning throwing getters → fresh start logged `warn`, never throws; absent record → fresh start logged `debug`, not `warn`; corrupt JSON, wrong `format`, wrong `name`, kind mismatch (flat record into `restoreHierarchyConfig` and vice versa), stale by `maxAgeMs` (fake `now`), flat unknown `value`, malformed spine (envelope-shape failure in `loadRecord`), hierarchy root-level unknown `value` → fresh start, each logged `warn` (deeper hierarchy mismatch is the partial-restore case below, not fresh start); constructor rejects malformed `source`/`toState`; restore functions reject `NaN`/negative/infinite `maxAgeMs`; flat roundtrip restores value + context with `version 0` / `previousValue null`; hierarchy deep-path roundtrip; hierarchy valid-prefix restore when a child state was renamed (upper levels restored, lower fresh); original config objects not mutated; `serialize`/`deserialize` overrides roundtrip a non-JSON-safe context; restored construction runs initial `onEnter` for the restored state; `now` throw on write → write skipped, logged `error`; `now` throw during the `maxAgeMs` check → fresh start, logged `error`, no throw; hierarchy root-level mismatch → `restored: false`, nothing applied; deeper mismatch → `restored: true` with `restoredLevels`/`recordLevels` reported and the truncation logged at `warn`; `loadRecord` returns any well-formed record regardless of kind while `restoreFsmConfig` rejects a `'hierarchy'` record and vice versa; compatibility tests import the real `fsm-hierarchy` types against the structural declarations.
5. Changeset `0.1.0`.

## Summary

`@bazariodev/fsm-persist` gives machines page-refresh survival with two thin layers over public seams: a write-through persistor on the structural snapshot port, and pure restore functions that rewrite `initial`/`context` for normal construction — spine-walking with valid-prefix semantics for hierarchies. State-at-rest only; effects re-fire on attach as the recovery model; corrupt or stale storage always degrades to a fresh start. Sync localStorage-shaped port in v1; async backends, tab sync, and migrations are deliberate backlog.
