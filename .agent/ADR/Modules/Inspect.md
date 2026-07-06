# ADR: FSM Inspect Module

- Status: Proposed
- Date: 2026-07-05

## Context

Debugging a telephony flow today means sprinkling `console.log` into hooks and effects, and documenting a machine means hand-drawing its states. The roadmap's R1 stretch names `fsm-inspect`: "dev-time transition trace, timeline log, Mermaid diagram export" (`ROADMAP.md`).

Everything a tracer needs already exists as sanctioned seams — `Base/CoreFSM.md` lists exactly three extension points this module uses and no others:

- **constructor configuration** for declarative injection of state hooks and transition hooks — full-fidelity capture (event, from/to, both contexts) without touching resolution internals
- **`subscribe()`** for post-commit observation — the structural `FsmSubscribable` port already consumed by `fsm-react` and `fsm-persist`
- **logger injection** — the core and every module report rejections and contained errors through an injected `Logger`, which means a recorder can *be* that logger and pull the whole family's diagnostics into one timeline

## Decision

We will build `@bazariodev/fsm-inspect` as a passive, dev-time observability kit with three independent pieces around one buffer:

- **`InspectRecorder`** — a bounded ring-buffer of typed entries with an optional live `onEntry` tap and a `Logger` adapter (`recorder.logger`) that turns any injected-logger diagnostics (core rejections, effects/delays/hierarchy containment reports) into timeline entries
- **capture layers** — `instrumentFsmConfig(config, recorder)`, a pure config transform that chains the core's transition hooks to record full-fidelity transition entries; and `recordSource(source, recorder, options)`, a subscribe-based commit timeline that works with *any* `FsmSubscribable` (flat machines, hierarchies, node handles, future domain modules)
- **diagram export** — `mermaidFromFsmConfig(config)` and `mermaidFromHierarchyConfig(config)`, pure functions rendering `stateDiagram-v2` text from configs (composite states for hierarchy children)

No core or sibling changes; nothing in this package runs unless explicitly constructed.

## Resolved decisions

These were open at drafting time and have been settled:

1. **Two capture layers, not a proxy machine.** Full fidelity (event type, pre/post context) comes from `instrumentFsmConfig` chaining the config-level hooks the core already defines. The lossy-but-universal layer is `recordSource` over the structural port. A send-wrapping decorator (`FsmCore` proxy) that could also capture *rejected* events is deliberately deferred — rejected events already reach the timeline through `recorder.logger` when the consumer passes it as the machine's logger, because the core logs rejections at `debug`.
2. **The recorder is a logger.** `recorder.logger` implements the workspace `Logger` interface and appends `log` entries. Passing it to `Fsm`, `FsmEffects`, `FsmDelays`, `FsmHierarchy`, or `FsmPersist` unifies the whole stack's diagnostics into one ordered timeline. Entries store the raw `message` and `meta` — no coupling to any package's message strings.
3. **Bounded ring buffer, default 500 entries.** Long-lived sessions must not grow memory unboundedly; oldest entries drop first. `limit` is configurable and validated (`>= 1`, finite integer).
4. **No environment magic.** The package never reads `NODE_ENV` or detaches itself in production; constructing a recorder is the opt-in. It is side-effect-free and tree-shakes to nothing when unused. Whether to ship instrumentation to production is the consumer's build concern.
5. **Recording is fail-silent.** A throw from `onEntry` or from `mapContext` must never break the machine being observed: it is caught and dropped (not even logged — the recorder cannot log to itself without recursion risk). This is stricter than the siblings' log-and-contain because the tool is diagnostic by nature; a diagnostics tool that crashes the app under diagnosis is a contradiction.
6. **Transitions are traced as a start/complete pair.** The core's fixed lifecycle runs `onTransitionStart` → `onStateLeave` → reducer → `onStateEnter` → `onTransitionBeforeCommit` → commit, so recording only at `beforeCommit` would silently lose any accepted transition aborted earlier (a target `onEnter` throw never reaches `beforeCommit`). The instrumenter therefore records a `transition-start` entry at `onTransitionStart` (from, to, event, pre-reducer context) and a `transition` entry at `onTransitionBeforeCommit` (adding the post-reducer context). Both entries carry a shared `attemptId` allocated by the recorder (`nextAttemptId()`, monotonic and unique across everything one recorder observes) — so pairing stays exact across repeated identical attempts, interleaved log entries, ring-buffer truncation, multiple machines sharing a `name` on one recorder, multiple machines built from the same instrumented config, synchronous sibling sends, and even deliberate double instrumentation. A `transition-start` whose `attemptId` has no matching `transition` is an aborted attempt — visible in the timeline instead of missing from it. The start/complete hooks run *before* the consumer's own chained hook, and a `transition` entry still precedes the consumer's `beforeCommit` hook, so a consumer throw there leaves both entries for a commit that never happened (documented caveat). Consumer hooks are always chained, never replaced.
7. **Everything captured may be redacted.** Four identity-default hooks cover every capture path: `mapContext` for contexts, `mapSnapshot` for `recordSource` snapshots, `mapEvent` for event payloads (entries store the full `event` alongside the extracted `eventType`, because payloads are the substance of telephony debugging — and also the PII), and `mapMeta` for log-entry metadata arriving through `recorder.logger`. Same concern the persist ADR documents, same consumer-side control, no capture path exempt.

## Scope

### In scope for v1

- `InspectRecorder`: `entries` (readonly ring buffer), `clear()`, `record(entry)` (public, so custom sources can append), `logger` adapter, `onEntry` tap, injectable `now`
- `instrumentFsmConfig` — pure transform; records `init` (initial-state entry during construction), `transition-start`, and `transition` entries; chains existing consumer hooks
- `recordSource` — subscribe-based `commit` entries for any `FsmSubscribable`; returns `{ stop() }`
- `mermaidFromFsmConfig` / `mermaidFromHierarchyConfig` — pure `stateDiagram-v2` renderers: initial markers, event-labeled edges, `[guarded]` markers, wildcard handling (`note` by default, `expand` opt-in), composite states for hierarchy children, quoted aliases for non-identifier state names
- `mapContext` / `mapSnapshot` redaction hooks; ring-buffer `limit`

### Out of scope for v1

- rejected-event capture via a send-wrapping `FsmCore` decorator (partially covered by the logger adapter; revisit with real demand)
- devtools UI, panels, or transports (the `onEntry` tap is the seam a future panel consumes)
- other diagram formats (DOT, PlantUML), diagram layout options beyond the wildcard mode
- time-travel, replay, or trace persistence (`fsm-persist` is for machine state, not traces)
- per-node automatic hierarchy instrumentation (consumers attach `recordSource` to node handles via `nodeFor`/`onNodeSpawned`)
- performance metrics, durations, or sampling

## Contracts

```ts
import type {
  DiagramTransitionDefinition,
  DiagramTransitionEntry,
  FsmDiagramConfig,
  FsmSubscribable,
  HierarchyDiagramConfig,
} from '@bazariodev/fsm';

type InspectEntry =
  | Readonly<{ type: 'init'; at: number; name: string; state: string; context: unknown }>
  | Readonly<{
      type: 'transition-start';
      at: number;
      name: string;
      attemptId: number;
      from: string;
      to: string;
      eventType: string;
      event: unknown;
      contextBefore: unknown;
    }>
  | Readonly<{
      type: 'transition';
      at: number;
      name: string;
      attemptId: number;
      from: string;
      to: string;
      eventType: string;
      event: unknown;
      contextBefore: unknown;
      contextAfter: unknown;
    }>
  | Readonly<{ type: 'commit'; at: number; name: string; label: string; snapshot: unknown }>
  | Readonly<{ type: 'log'; at: number; level: 'debug' | 'warn' | 'error'; message: string; meta?: unknown }>;

type InspectRecorderOptions = Readonly<{
  limit?: number;                          // default 500, integer >= 1
  now?: () => number;                      // default Date.now
  mapContext?: (context: unknown) => unknown;   // redaction, default identity
  mapSnapshot?: (snapshot: unknown) => unknown; // redaction, default identity
  mapEvent?: (event: unknown) => unknown;       // redaction, default identity
  mapMeta?: (meta: unknown) => unknown;         // redaction for log entries, default identity
  onEntry?: (entry: InspectEntry) => void;      // live tap, fail-silent
}>;

class InspectRecorder {
  constructor(options?: InspectRecorderOptions);
  readonly entries: ReadonlyArray<InspectEntry>; // frozen defensive copy per access
  readonly logger: Logger;                 // appends 'log' entries
  record(entry: InspectEntry): void;
  nextAttemptId(): number;                 // monotonic; used by capture layers and custom sources
  clear(): void;
}

function instrumentFsmConfig<TState extends string, TEvent extends FsmEvent, TContext>(
  config: FsmConfig<TState, TEvent, TContext>,
  recorder: InspectRecorder,
): FsmConfig<TState, TEvent, TContext>;

function recordSource<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
  recorder: InspectRecorder,
  options: Readonly<{ name: string; label?: (snapshot: unknown) => string }>,
): Readonly<{ stop: () => void }>;

type MermaidOptions = Readonly<{ wildcard?: 'note' | 'expand' }>; // default 'note'

function mermaidFromFsmConfig(config: FsmDiagramConfig, options?: MermaidOptions): string;
function mermaidFromHierarchyConfig(config: HierarchyDiagramConfig, options?: MermaidOptions): string;
```

`FsmSubscribable` is the canonical structural declaration exported by `@bazariodev/fsm` and re-exported here for compatibility with the module API. The diagram shapes are deliberately **named differently** from persist's `HierarchyConfigLike`: the renderer needs `transitions` (to draw edges), which persist's shape intentionally omits — one name for two shapes would imply a reuse that does not exist. Transition values are typed `unknown` deliberately: `AnyHierarchyConfig` erases its entries to `unknown`, so a stricter input type would reject the very configs consumers build for `FsmHierarchy`. The renderers narrow each entry to `DiagramTransitionDefinition` at runtime and fail fast with a precise message on anything else. During the R1 freeze, the port and config-shape family moved into `@bazariodev/fsm`; inspect re-exports its API names from that source of truth.

## Rules

Recorder:

- the buffer holds at most `limit` entries; appending beyond it drops the oldest first, and `entries` always returns them oldest-to-newest
- `entries` returns a **frozen defensive copy** — `ReadonlyArray` is a compile-time promise only, and handing out the backing buffer would let JavaScript consumers mutate recorder state. The copy is cached and invalidated by any write (`record`, `clear`, ring-drop), so repeated reads between writes return the same frozen array at O(1); tests assert frozenness, isolation, and cache identity
- `record` stores a **shallow-frozen shallow copy** of the entry envelope, so mutating the caller's object afterwards cannot rewrite history; nested `context`/`snapshot`/`meta` values stay by reference — the core's shallow-freeze doctrine applied to entries. `onEntry` receives the stored frozen copy
- `record` stamps nothing: the caller provides the full entry. The capture layers stamp `at` via the recorder's internal guarded clock; custom sources calling `record` provide their own `at` (there is no public timestamp helper)
- the internal clock guards the injected `now`: a throw or non-finite result drops the entry being captured, silently (decision 5) — this applies to every capture layer **and** to `recorder.logger`, which may be invoked from inside the core's own logging paths where a throw would break the observed machine
- `onEntry` fires after the entry is buffered; a throwing `onEntry` or any redaction hook (`mapContext`/`mapSnapshot`/`mapEvent`/`mapMeta`) is caught and the entry dropped silently (decision 5)
- `recorder.logger` methods append `log` entries with the recorder's timestamp; `meta` passes through `mapMeta` and is otherwise stored by reference, not cloned
- `clear()` empties the buffer without detaching anything

`instrumentFsmConfig`:

- pure: returns a new config object; the input config is never mutated; calling it twice on the same config double-records (documented, not defended)
- wraps `onTransitionStart` to record `transition-start` entries and `onTransitionBeforeCommit` to record `transition` entries (recorder first, consumer's original hook after, for both), plus the initial state's `onEnter` to record the `init` entry (same order); attempt ids are tracked with a LIFO stack so one instrumented config can legally construct multiple machines that synchronously send to each other without corrupting start/complete pairing
- an accepted transition that aborts between the two hooks (an `onStateLeave`/reducer/target-`onEnter` throw) leaves a `transition-start` with no matching `transition` — the aborted attempt is visible in the timeline by design
- `contextBefore`/`contextAfter` and the `init` context pass through `mapContext`; the captured `event` passes through `mapEvent`, with `eventType` extracted *before* mapping so scanning stays cheap even when payloads are redacted away
- self-transitions record like any accepted transition (`from === to`); per core semantics they fire `onTransitionBeforeCommit`, so nothing special is needed

`recordSource`:

- subscribes with a listener declared `(snapshot?: TSnapshot) => void`, matching the shared core port while still accepting zero-argument change signals, and records **the delivered payload when present**. During nested subscriber sends the core delivers each committed snapshot to its own pass while `source.snapshot` may already be newer (`Base/CoreFSM.md` §8), so live-reading would duplicate the newest commit and lose intermediates. This is the deliberate inverse of the persist writer's payload-ignoring rule: storage wants last-write-wins, a timeline wants every commit — both choices are principled and both are documented
- **every** recorded snapshot — payload-delivered or fallback-read — passes a reference-dedupe against the last recorded one. Genuine commits always produce fresh references (core §2), so dedupe never suppresses a real commit; it suppresses redundant deliveries of the *same* reference — the canonical case being a hierarchy node handle attached in `onNodeSpawned`, whose version-0 birth notification arrives right after the attach-time capture of the same snapshot (`Modules/Hierarchy.md` handle deltas)
- only when a source truly delivers no payload does the listener fall back to reading `source.snapshot`; the fallback's lossiness under nested sends is documented
- records a `commit` entry per delivered snapshot after applying `mapSnapshot`; `label` is derived from the mapped snapshot via the option, or a best-effort default: a string `value` field, else a string `path` field, else `"snapshot"`
- captures the construction-time snapshot once at attach (so the timeline starts with the current state), then per notification
- `stop()` unsubscribes and is idempotent; entries already recorded remain

Mermaid:

- output targets `stateDiagram-v2`. Flat rendering emits safe state names as bare identifiers (one namespace — the same name *is* the same state), reserves those ids, and aliases unsafe ones via `state "<name>" as s<n>` with ordinal suffixes when sanitized aliases would collide. Hierarchy rendering **path-scopes every state id**: Mermaid ids are global across composite blocks, and per-node validation legitimately allows the same safe name at different levels, so each state's id derives from its sanitized dotted path (ordinal suffix on sanitization collisions) and is always emitted as `state "<name>" as <id>` with the bare name as the label
- one edge per transition definition, labeled with the event type; definitions carrying a guard get a ` [guarded]` suffix; multiple definitions for one event yield multiple edges in declaration order
- `[*] --> initial` marks the initial state at every level; hierarchy children render as nested composite `state <parent> { ... }` blocks, recursively
- wildcard (`*`) transitions render as a `note` block listing them by default; `wildcard: 'expand'` draws them as edges from every state instead (accurate but dense)
- **escaping is explicit and tested**: event labels, note text, and quoted state aliases are arbitrary strings — literal `#` is encoded before Mermaid can interpret entity-like text, double quotes are encoded as `#quot;`, newlines collapse to single spaces, and backticks/semicolons/colons inside labels are encoded so they cannot terminate or restructure Mermaid syntax; dedicated tests cover hashes, quotes, newlines, colons, semicolons, and non-ASCII names in all three positions
- each transition entry is narrowed at runtime to `DiagramTransitionDefinition` (single or array); entries that do not match throw the renderer's malformed-config error
- renderers are total for validated configs and throw only on structurally broken input (fail-fast, these are build/dev-time calls — the untrusted-input doctrine of persist does not apply here because configs are caller code, not storage)

## Composition

```ts
const recorder = new InspectRecorder({ limit: 1000, mapContext: redactTokens });

// logger injection happens at the config level — that is how core rejection
// debug logs actually reach the timeline:
const machine = new Fsm(
  instrumentFsmConfig({ ...callConfig, logger: recorder.logger }, recorder),
); // init + transition-start/transition + rejection log entries

const effects = new FsmEffects(machine, {
  ...callEffects,
  logger: recorder.logger,
}); // containment reports → log entries (EffectsConfig carries the logger)

const timeline = recordSource(hierarchy, recorder, { name: 'call-tree' }); // composed commits
```

One recorder, one ordered timeline across the whole stack. The README shows this and the `onEntry` console tap.

## Error policy

- `onEntry`, `mapContext`, `mapSnapshot`, `mapEvent`, `mapMeta`, `label`, and injected `now` throws (or a non-finite `now` result): caught, entry dropped silently (decision 5) — observation must never alter or break the observed; this includes `recorder.logger` calls arriving from inside the core's own logging paths
- consumer hooks chained by `instrumentFsmConfig` keep the core's error policy exactly (their throws still abort the commit and rethrow from `send`); the recorder's own wrapper never throws
- Mermaid renderers and constructor option validation throw on programmer errors (trusted caller input, fail fast — same boundary as persist)

## Security

Traces capture contexts, snapshots, event payloads, and log `meta` by reference. The persist ADR's warning applies doubled: a ring buffer of these can retain tokens/PII in memory and in anything `onEntry` forwards them to — and `recorder.logger` is a first-class capture path, so containment-report metadata from every sibling package flows in too. `mapContext`/`mapSnapshot`/`mapEvent`/`mapMeta` are the redaction points; the README states that recorders wired to remote sinks must redact all four.

## Validation

Constructor fails fast for: non-integer or `< 1` `limit`, non-function `now`/`mapContext`/`mapSnapshot`/`mapEvent`/`mapMeta`/`onEntry` when provided. `instrumentFsmConfig` fails fast for a non-object config or missing recorder; `recordSource` for a malformed source (`subscribe` must be a function), missing recorder, or empty `name`. Diagnostic strings live in `internal/messages.ts` per workspace convention.

## Packaging

- new package `@bazariodev/fsm-inspect`; peer: `@bazariodev/fsm` (current major, types only — zero runtime imports)
- `fsm-hierarchy` is a devDependency for compatibility tests of the structural shapes, per the persist precedent; never a peer
- same tooling (tsup, vitest node env, Biome), `internal/messages.ts` + `internal/predicates.ts`, README + LICENSE, changeset at `0.1.0`

## Consequences

Positive:

- one ordered timeline for the entire FSM family with zero new seams — the module is proof the core's extension-seam list was right
- diagrams stop drifting from code: they render from the same config object that runs
- the `onEntry` tap is the future devtools seam without committing to any UI now

Tradeoffs:

- `instrumentFsmConfig` must be applied at construction time; already-running machines only get the lossy `recordSource` layer
- transition tracing is pre-commit by nature (decision 6): a consumer `onTransitionBeforeCommit` throw after recording leaves a start/transition pair for a commit that never happened; the pair model makes earlier aborts visible but cannot distinguish "committed" from "aborted in the consumer's final hook" without a post-commit correlation this dev tool deliberately skips
- `FsmSubscribable` and the config-shape family now live in `@bazariodev/fsm`; inspect keeps compatibility re-exports while depending on the core source of truth. The diagram config shapes still deliberately diverge from persist's same-purpose shapes because the renderer needs `transitions`.
- entries hold context/snapshot references; memory pressure is bounded by `limit` but retention within the window is real (redaction hooks are the valve; `recordSource` labels are derived only after `mapSnapshot`)

## Next steps

1. Scaffold `packages/fsm-inspect/` (peer `@bazariodev/fsm`, devDep `fsm-hierarchy`, tsconfig, tsup, vitest node env, README with the unified-timeline example and redaction warning, LICENSE).
2. Types + `internal/messages.ts` / `internal/predicates.ts`.
3. Implement `InspectRecorder` (ring buffer, logger adapter, onEntry), then `instrumentFsmConfig`, `recordSource`, then the two Mermaid renderers.
4. Tests: ring buffer drops oldest at `limit` and preserves order; `entries` returns a frozen copy — mutating the returned array does not affect the recorder, repeated reads between writes return the same cached reference, and any write invalidates it; `record` stores a shallow-frozen envelope copy so mutating the caller's entry object afterwards does not rewrite the buffer while `context`/`meta` stay by reference; `record` appends and `clear` empties; `onEntry` receives each entry after buffering; throwing `onEntry`/`mapContext`/`mapSnapshot`/`mapEvent`/`mapMeta`/`label` is swallowed and the machine keeps transitioning; the pair entries carry the full `event` through `mapEvent` while `eventType` survives redaction; `log` entry `meta` passes through `mapMeta`; throwing or non-finite `now` drops the entry silently in every capture layer **and** in the `logger` adapter (asserted with a machine whose core logger is `recorder.logger`); `logger` adapter appends `log` entries with level/message/meta; `instrumentFsmConfig` records `init` with mapped context, records a `transition-start`/`transition` pair sharing a recorder-allocated `attemptId`; two machines with the same `name` observed by one recorder get disjoint `attemptId`s (pairing unambiguous); it records the pair (from/to/eventType/contexts) on accepted transitions including self-transitions, chains consumer hooks (recorder-first order asserted for both wrapped hooks), never mutates the input config, and double-instrumentation double-records; a target `onEnter` throw leaves a `transition-start` with an unmatched `attemptId` (abort visible); a consumer beforeCommit throw leaves the pair and aborts the commit; `recordSource` captures the attach-time snapshot then per-commit entries, records every commit exactly once and in order when a subscriber triggers a nested send (payload-first), applies the reference-dedupe to payload deliveries as well — attaching via `onNodeSpawned` records the birth snapshot exactly once despite attach-time capture plus the version-0 birth notification — and dedupes identically in the zero-payload fallback, default label picks `value` then `path` then `"snapshot"`, custom `label` used when given, `stop()` idempotent; hierarchy as source via structural port; Mermaid flat: initial marker, event edges, guard suffix, multi-definition edges, alias quoting for unsafe names, wildcard note vs expand, and escaping of quotes/newlines/colons/semicolons/non-ASCII in event labels, note text, and quoted aliases; Mermaid hierarchy: nested composite blocks with per-level initial markers, and duplicated safe state names at different levels render as distinct path-scoped ids with correct edges; renderer fail-fast on malformed config; option validation for limit/now/hooks; compatibility test feeding real `FsmConfig` and `AnyHierarchyConfig` objects to the diagram shapes and real `fsm-hierarchy` snapshots to the port.
5. Changeset `0.1.0`.

## Summary

`@bazariodev/fsm-inspect` is the FSM family's dev-time observability kit: a bounded `InspectRecorder` with a logger adapter that unifies the whole stack's diagnostics into one timeline, full-fidelity transition tracing via a pure config transform over the core's sanctioned hook seams, a universal commit timeline over the structural port, and Mermaid renderers that keep diagrams generated from the configs that actually run. Passive, opt-in, fail-silent, redactable, zero runtime dependencies — and deliberately free of devtools UI, replay, and rejected-event proxying until real demand exists.
