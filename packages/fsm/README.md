# @bazariodev/fsm

A small, strongly typed, dependency-free finite state machine for TypeScript. Designed for realtime communications workflows such as SIP signaling, call lifecycle, chat orchestration, and reconnect flows.

The base core is intentionally narrow: deterministic transitions, synchronous context reducers, configuration-driven lifecycle hooks, post-commit subscriptions, and configurable logging. Everything else (effects, timers, history, persistence, hierarchical states) is out of scope for v1 and intended to be composed around the core.

## Install

```sh
pnpm add @bazariodev/fsm
```

## Quick start

```ts
import { Fsm } from '@bazariodev/fsm';

type CallState = 'idle' | 'dialing' | 'connected' | 'failed';

type CallEvent =
  | { type: 'DIAL'; destination: string }
  | { type: 'CONNECT' }
  | { type: 'FAIL' };

type CallContext = {
  attempts: number;
  destination: string | null;
};

const machine = new Fsm<CallState, CallEvent, CallContext>({
  name: 'call-flow',
  initial: 'idle',
  context: { attempts: 0, destination: null },
  states: {
    idle: {},
    dialing: {
      onEnter: ({ context }) => console.log(`dialing ${context.destination}`),
    },
    connected: {},
    failed: {},
  },
  transitions: {
    idle: {
      DIAL: {
        target: 'dialing',
        reducer: (context, event) => ({
          attempts: context.attempts + 1,
          destination: event.type === 'DIAL' ? event.destination : context.destination,
        }),
      },
    },
    dialing: {
      CONNECT: { target: 'connected' },
    },
    connected: {},
    failed: {},
    '*': {
      FAIL: { target: 'failed' },
    },
  },
});

machine.subscribe((snapshot) => {
  console.log(snapshot.value, snapshot.version);
});

machine.send({ type: 'DIAL', destination: '1001' });
machine.send({ type: 'CONNECT' });
```

## Core concepts

### Snapshot

`machine.snapshot` is a frozen object with the current state and context:

```ts
type FsmSnapshot<TState, TContext> = Readonly<{
  value: TState;
  previousValue: TState | null;
  context: Readonly<TContext>;
  version: number;
}>;
```

- `value` is the current state.
- `previousValue` is the source state of the last committed transition. On a self-transition it equals `value`. It is `null` immediately after construction.
- `context` is the extended state. `Readonly<TContext>` is shallow; nested fields are not frozen at runtime, but should be treated as immutable by convention.
- `version` starts at `0` and increments by one on every committed transition.
- The snapshot object itself is shallow-frozen. Its reference is stable until the next commit.

`machine.state` and `machine.context` are convenience accessors for the corresponding snapshot fields.

### Transitions

Transitions are declared as `transitions[sourceState][eventType]`. An entry can be a single definition or an array of definitions evaluated in order. The first transition whose guard passes wins.

```ts
type TransitionDefinition<TState, TEvent, TContext> = {
  target: TState;
  guard?: (context: Readonly<TContext>, event: TEvent) => boolean;
  reducer?: (context: Readonly<TContext>, event: TEvent) => TContext;
};
```

- `target` must be a real declared state name. It cannot be `*`.
- `guard` must be synchronous, pure, and side-effect free. If a guard throws, the transition is rejected and the error is rethrown from `send()`.
- `reducer` returns the next context. If omitted, context is unchanged.

### Wildcard transitions

`*` is a reserved source key for global transitions such as `RESET`, `CANCEL`, `FAIL`, or `TERMINATE`. Wildcard transitions are only considered when the current state does not declare an entry for the event type.

If the current state declares the event and every guard fails, the transition is rejected. The runtime does not fall back to `*` in that case.

### Lifecycle hooks

`send(event)` runs hooks in this fixed order:

1. `onTransitionStart` (transition-level)
2. `onLeave` on the source state, only if the target differs
3. apply the transition's `reducer` to compute the next context
4. `onEnter` on the target state, only if the target differs
5. `onTransitionBeforeCommit` (transition-level)
6. commit the next snapshot
7. notify subscribers

All hooks are optional, synchronous, and configuration-driven. During pre-commit hooks, `machine.snapshot`, `machine.state`, and `machine.context` still return the last committed snapshot — hooks should rely on the payload they receive.

If any hook, guard, or reducer throws, the snapshot is not changed and the error is rethrown from `send()`.

### Subscriptions

```ts
const unsubscribe = machine.subscribe((snapshot) => { /* ... */ });
```

- Subscribers are notified only after a transition is committed.
- The runtime snapshots the current subscriber list before notifying, so `subscribe()` or unsubscribe calls inside a callback do not change the current delivery pass.
- `unsubscribe` is idempotent.
- If a subscriber triggers a nested transition via `send()`, the nested notification pass runs to completion before the original pass resumes. Later subscribers in the original pass may therefore receive an older snapshot than `machine.snapshot`. Use the snapshot argument the subscriber receives rather than reading `machine.snapshot`.
- A subscriber failure does not block other subscribers. The error is reported through the injected logger.

### Re-entrancy

If `send()` is called while another transition is being processed, the machine throws a plain `Error`. The transition lock is released on every exit path, including rejection and thrown errors.

### Logger

Logging is optional and injected:

```ts
type Logger = {
  debug(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};
```

The default is a no-op logger. The runtime never depends on `console` directly.

### Initialization

State is ready immediately after construction:

- The initial snapshot has `version: 0` and `previousValue: null`.
- The initial state's `onEnter` runs during construction with `from: null` and `event: null`.
- `onTransitionStart` and `onTransitionBeforeCommit` do not run during construction.
- If the initial `onEnter` throws, the constructor rethrows and no instance is exposed.
- Subscribers only observe transitions that happen after construction.

## API

### Class

```ts
class Fsm<TState extends string, TEvent extends FsmEvent, TContext>
  implements FsmCore<TState, TEvent, TContext>
{
  constructor(config: FsmConfig<TState, TEvent, TContext>);

  readonly name: string;
  readonly snapshot: FsmSnapshot<TState, TContext>;
  readonly state: TState;
  readonly context: Readonly<TContext>;

  send(event: TEvent): void;
  can(event: TEvent): boolean;
  subscribe(listener: FsmSubscriber<TState, TContext>): Unsubscribe;
}
```

### `can(event)`

`can(event)` accepts the full event object so guards can read its payload. It runs the same lookup and guard resolution path as `send(event)`, including wildcard fallback, but does not invoke reducers, lifecycle hooks, commit changes, or notify subscribers. It never throws purely because a transition is already in progress.

### Types

`FsmConfig`, `FsmSnapshot`, `FsmEvent`, `Guard`, `ContextReducer`, `TransitionDefinition`, `TransitionEntry`, `TransitionMap`, `StateDefinition`, `StateEnterPayload`, `StateLeavePayload`, `TransitionStartPayload`, `TransitionCommitPayload`, `Logger`, `FsmSubscriber`, `Unsubscribe`, and `FsmCore` are all exported from the package root.

`FsmCore` is the public contract the `Fsm` class implements. Consumers can depend on it directly for dependency injection or test doubles.

## Configuration validation

The constructor fails fast on:

- empty `name`
- `initial` state that is not declared in `states`
- `*` used as a state name
- transition source states other than `*` that are not declared in `states`
- transition targets that are not declared in `states`
- `*` used as a transition target
- malformed transition definitions

## Out of scope for v1

The following are intentionally deferred and will be added as separate modules once the base core is stable:

- async effects
- delays and timers
- history
- persistence
- hierarchical and parallel states
- transport-specific integrations
- plugin systems beyond configuration hooks and subscriptions

## License

MIT
