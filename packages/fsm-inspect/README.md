# @bazariodev/fsm-inspect

Development tools for [`@bazariodev/fsm`](https://www.npmjs.com/package/@bazariodev/fsm) machines:
record a timeline of transitions and log messages, and draw Mermaid state diagrams from configs.
It's opt-in and has no side effects on import.

## Install

```sh
pnpm add @bazariodev/fsm-inspect @bazariodev/fsm
```

`@bazariodev/fsm` is a peer dependency.

## Record a timeline

```ts
import { Fsm } from '@bazariodev/fsm';
import { InspectRecorder, instrumentFsmConfig } from '@bazariodev/fsm-inspect';

// `callConfig` is your FsmConfig.
const recorder = new InspectRecorder();
const machine = new Fsm(instrumentFsmConfig(callConfig, recorder));

machine.send({ type: 'DIAL', destination: '101' });
console.table(recorder.entries); // init, transition-start, transition
```

`instrumentFsmConfig` returns a new config that also records to `recorder`; your config isn't
changed. Apply it before constructing the machine. It works with `restoreFsmConfig` from
`@bazariodev/fsm-persist` in either order.

### One timeline for the whole stack

Pass `recorder.logger` to every package, and use `onEntry` to watch entries as they're recorded:

```ts
import { Fsm } from '@bazariodev/fsm';
import { FsmEffects } from '@bazariodev/fsm-effects';
import { InspectRecorder, instrumentFsmConfig, recordSource } from '@bazariodev/fsm-inspect';

const recorder = new InspectRecorder({ onEntry: (entry) => console.debug(entry) });
const machine = new Fsm(instrumentFsmConfig({ ...callConfig, logger: recorder.logger }, recorder));
// `callEffects` is your effects map.
const effects = new FsmEffects(machine, { effects: callEffects, logger: recorder.logger });
const commits = recordSource(machine, recorder, { name: 'call' });

// later
commits.stop();
effects.stop();
```

### Entries

| `type` | Recorded when | Main fields |
| --- | --- | --- |
| `init` | The machine is constructed | `name`, `state`, `context` |
| `transition-start` | A transition begins | `attemptId`, `from`, `to`, `eventType`, `event`, `contextBefore` |
| `transition` | The transition reaches its last step before commit | The `transition-start` fields plus `contextAfter` |
| `commit` | `recordSource` sees a new snapshot | `name`, `label`, `snapshot` |
| `log` | A package logs through `recorder.logger` | `level`, `message`, `meta` |

Every entry has `at`, a timestamp from the recorder's clock. A `transition-start` and its
`transition` share an `attemptId`.

A `transition` entry doesn't prove the transition committed: your own `onTransitionBeforeCommit`
can still throw after it's recorded. A `transition-start` without a matching `transition` usually
means the attempt threw before that point, but it's not proof: a throwing clock or map function
drops the `transition` entry while the machine still commits. For confirmed commits, use
`recordSource`.

## Record any source

`recordSource(source, recorder, { name, label? })` works with `Fsm`, `FsmHierarchy`, hierarchy node
handles, and anything else with a stable `snapshot` and `subscribe(listener)`:

```ts
const recording = recordSource(hierarchy, recorder, { name: 'call' });

// later
recording.stop(); // the entries stay in the recorder
```

It records the current snapshot right away, then one `commit` entry for each new snapshot. The
`label` defaults to the snapshot's `value` (flat machines) or `path` (hierarchies). Pass a `label`
function to compute your own from the snapshot.

## Recorder options

| Option | Meaning |
| --- | --- |
| `limit` | Maximum entries kept; the oldest is dropped first. Default `500`. |
| `now` | Clock for `at`; defaults to `Date.now`. |
| `mapContext`, `mapSnapshot`, `mapEvent`, `mapMeta` | Transform what's stored, for redaction. By default everything is stored as is. |
| `onEntry` | Called with each stored entry. Errors it throws are ignored. |

The constructor throws if `limit` isn't an integer of at least 1, or if a function option isn't a
function.

- `recorder.entries` is a frozen array, oldest first.
- `recorder.logger` is a `Logger` that records `log` entries.
- `recorder.clear()` removes all entries.
- `recorder.record(entry)` and `recorder.nextAttemptId()` let you add entries of your own.

Recording never breaks the machine. If the clock or a map function throws, that entry is dropped.

## Mermaid diagrams

```ts
import { mermaidFromFsmConfig, mermaidFromHierarchyConfig } from '@bazariodev/fsm-inspect';

const diagram = mermaidFromFsmConfig(callConfig);
const tree = mermaidFromHierarchyConfig(rootConfig); // child machines become nested states
```

Both return `stateDiagram-v2` text and throw if the config references an undeclared state. Wildcard
(`*`) transitions are drawn as a note by default. Pass `{ wildcard: 'expand' }` to draw them as
edges from every state without its own entry for that event. For a config with `idle → dialing` on
`DIAL` and `*` → `failed` on `FAIL`, `mermaidFromFsmConfig(callConfig, { wildcard: 'expand' })`
returns:

```text
stateDiagram-v2
  state "idle" as idle
  state "dialing" as dialing
  state "failed" as failed
  [*] --> idle
  idle --> dialing: DIAL
  idle --> failed: FAIL
  dialing --> failed: FAIL
  failed --> failed: FAIL
```

Mermaid ids come from each state's full dotted path, so the same state name in different nested
machines doesn't collide.

## Redaction

The recorder keeps contexts, snapshots, events, and log metadata in memory by reference. If entries
leave the process, for example when `onEntry` sends them to a remote sink, redact all four capture
paths:

```ts
// The redact* functions are yours.
const recorder = new InspectRecorder({
  mapContext: redactContext,
  mapSnapshot: redactSnapshot,
  mapEvent: redactEvent,
  mapMeta: redactLogMeta,
});
```

Labels are computed from the mapped snapshot, so redaction applies to them too. Keeping credentials,
tokens, and personal data out of context and events in the first place is still the better default.

## License

MIT
