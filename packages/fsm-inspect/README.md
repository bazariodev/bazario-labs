# @bazariodev/fsm-inspect

Dev-time inspection helpers for the Bazario FSM family.

`@bazariodev/fsm-inspect` is opt-in and side-effect free. It gives you:

- a bounded `InspectRecorder` timeline
- config instrumentation for `init`, `transition-start`, and `transition` entries
- a logger adapter that records `debug` / `warn` / `error` diagnostics
- `recordSource` for subscribe-based commit timelines
- Mermaid `stateDiagram-v2` export for flat and hierarchy configs

## Timeline

```ts
import { Fsm } from '@bazariodev/fsm';
import { FsmEffects } from '@bazariodev/fsm-effects';
import {
  InspectRecorder,
  instrumentFsmConfig,
  recordSource,
} from '@bazariodev/fsm-inspect';

const recorder = new InspectRecorder({
  limit: 1000,
  mapContext: redactContext,
  mapEvent: redactEvent,
  mapSnapshot: redactSnapshot,
  mapMeta: redactLogMeta,
  onEntry: (entry) => console.debug(entry),
});

const machine = new Fsm(
  instrumentFsmConfig({ ...callConfig, logger: recorder.logger }, recorder),
);

const effects = new FsmEffects(machine, {
  ...callEffects,
  logger: recorder.logger,
});

const commits = recordSource(machine, recorder, { name: 'call' });

machine.send({ type: 'DIAL', destination: '101' });

console.table(recorder.entries);
commits.stop();
effects.stop();
```

`instrumentFsmConfig` is a pure transform. It returns a new config object and never mutates the input. Apply it before constructing the machine. It wraps only the transition hooks and each state's `onEnter`, calling the originals with the receiver the core passes, so a config the core would reject still fails the same way, and the `init` entry names the state the machine actually starts in, even when `initial` changes after instrumentation (for example through `restoreFsmConfig`).

Transitions are traced as a start/complete pair:

- `transition-start` is recorded from `onTransitionStart`
- `transition` is recorded from `onTransitionBeforeCommit`
- both entries share a recorder-allocated `attemptId`

If an accepted transition aborts before `onTransitionBeforeCommit`, the timeline contains only `transition-start`. If the consumer's own `onTransitionBeforeCommit` throws after the inspector records, both entries remain even though the commit aborts.

## Source Recording

`recordSource(source, recorder, options)` works with anything exposing:

```ts
import type { FsmSubscribable } from '@bazariodev/fsm';
```

The shared core shape is a stable `snapshot` accessor plus `subscribe(listener)`, where the listener may receive the committed snapshot.

It records the attach-time snapshot, then one `commit` entry per delivered snapshot. If a source calls the listener without a payload (or with `undefined`), `recordSource` reads `source.snapshot` instead. Payload-delivered and fallback snapshots are deduped by reference, so hierarchy node birth snapshots are recorded once.

Commit labels are derived from the mapped snapshot, so `mapSnapshot` redaction applies before the default `value` / `path` label or a custom `label` callback runs.

## Mermaid

```ts
import { mermaidFromFsmConfig } from '@bazariodev/fsm-inspect';

const diagram = mermaidFromFsmConfig(callConfig);
```

The renderers generate `stateDiagram-v2` text from configs and throw when a diagram references an undeclared state. Wildcard transitions render as notes by default:

```ts
mermaidFromFsmConfig(callConfig, { wildcard: 'note' });
```

Use `wildcard: 'expand'` to draw wildcard transitions as edges instead, from every state without its own entry for that event.

Every Mermaid id is derived from the state's dotted path, so repeated state names in nested machines do not collide.

## Redaction

Inspection retains contexts, snapshots, events, and log metadata in memory by reference. If a recorder forwards entries to a remote sink, redact all capture paths:

- `mapContext`
- `mapSnapshot`
- `mapEvent`
- `mapMeta`

Keeping credentials, tokens, and PII out of machine context and event payloads is still the better default.
