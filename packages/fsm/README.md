# @bazariodev/fsm

A small, dependency-free finite state machine, implemented in plain JavaScript with strict TypeScript declarations for its public interface. Designed for realtime communications workflows such as SIP signaling, call lifecycle, chat orchestration, and reconnect flows.

The base core is intentionally narrow: deterministic transitions, synchronous context reducers, configuration-driven lifecycle hooks, post-commit subscriptions, and configurable logging. Effects, timers, persistence, hierarchical states, and framework bindings are provided by separate packages composed around the core.

## Install

```sh
pnpm add @bazariodev/fsm
```

## Usage

```ts
import { Fsm } from '@bazariodev/fsm';

type CallState = 'idle' | 'dialing' | 'connected';
type CallEvent = { type: 'DIAL' } | { type: 'CONNECT' } | { type: 'HANGUP' };
type CallContext = { attempts: number };

const call = new Fsm<CallState, CallEvent, CallContext>({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0 },
  states: { idle: {}, dialing: {}, connected: {} },
  transitions: {
    idle: {
      DIAL: { target: 'dialing', reducer: (context) => ({ attempts: context.attempts + 1 }) },
    },
    dialing: { CONNECT: { target: 'connected' } },
    connected: { HANGUP: { target: 'idle' } },
  },
});

call.subscribe((snapshot) => console.log(snapshot.value, snapshot.context.attempts));

call.send({ type: 'DIAL' }); // logs "dialing 1"
call.send({ type: 'CONNECT' }); // logs "connected 1"
```

An event the current state doesn't handle is rejected: nothing changes, and subscribers aren't
notified. Guards, wildcard transitions, and lifecycle hooks are shown below.

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

For example, a call that stops dialing after three attempts and records where it's dialing:

```ts
import { Fsm } from '@bazariodev/fsm';

type CallState = 'idle' | 'dialing' | 'blocked';
type CallEvent = { type: 'DIAL'; destination: string } | { type: 'HANGUP' };
type CallContext = { attempts: number; destination: string | null };

const call = new Fsm<CallState, CallEvent, CallContext>({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0, destination: null },
  states: { idle: {}, dialing: {}, blocked: {} },
  transitions: {
    idle: {
      DIAL: [
        // Tried in order; the first definition whose guard passes wins.
        { target: 'blocked', guard: (context) => context.attempts >= 3 },
        {
          target: 'dialing',
          // Guards and reducers receive the whole event union; narrow on `event.type`.
          reducer: (context, event) => ({
            attempts: context.attempts + 1,
            destination: event.type === 'DIAL' ? event.destination : context.destination,
          }),
        },
      ],
    },
    dialing: { HANGUP: { target: 'idle' } },
  },
});
```

### Wildcard transitions

`*` is a reserved source key for global transitions such as `RESET`, `CANCEL`, `FAIL`, or `TERMINATE`. Wildcard transitions are only considered when the current state does not declare an entry for the event type.

```ts
// in `transitions`: every state without its own `HANGUP` entry goes back to `idle`
'*': { HANGUP: { target: 'idle' } },
```

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

```ts
// in `states`:
dialing: {
  onEnter: ({ from, context }) => console.log(`dialing from ${from}, attempt ${context.attempts}`),
  onLeave: ({ to }) => console.log(`leaving dialing for ${to}`),
},
```

All hooks are optional, synchronous, and configuration-driven. During pre-commit hooks, `machine.snapshot`, `machine.state`, and `machine.context` still return the last committed snapshot — hooks should rely on the payload they receive.

If any hook, guard, or reducer throws, the snapshot is not changed and the error is rethrown from `send()` unchanged. The runtime does not also log it.

### Subscriptions

```ts
const unsubscribe = machine.subscribe((snapshot) => { /* ... */ });
```

- Subscribers are notified only after a transition is committed.
- The runtime snapshots the current subscriber list before notifying, so `subscribe()` or unsubscribe calls inside a callback do not change the current delivery pass.
- `unsubscribe` is idempotent.
- If a subscriber triggers a nested transition via `send()`, the newer snapshot is delivered to every subscriber and the original pass stops. Every subscriber ends on the latest snapshot; a subscriber may skip an intermediate snapshot produced by a nested send, but never receives an older snapshot after a newer one.
- A subscriber failure does not block other subscribers. The error is reported through the injected logger.

### Re-entrancy

Calling `send()` from a guard, reducer, or lifecycle hook throws a plain `Error`, because the machine is in the middle of a transition. Subscribers run after the commit, so they may call `send()` (see Subscriptions). The transition lock is released on every exit path, including rejection and thrown errors.

### Logger

Logging is optional and injected:

```ts
type Logger = {
  debug(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};
```

The default is a no-op logger. The runtime never depends on `console` directly. It logs rejected events at `debug` level and subscriber failures at `error` level; errors rethrown to the caller are not logged.

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

All configuration, payload, snapshot, and logger types are exported from the package root, for example `FsmConfig`, `FsmSnapshot`, `TransitionDefinition`, and `Logger`.

- `FsmCore` is the contract `Fsm` implements. Depend on it for dependency injection or test doubles.
- `FsmSubscribable` is the shape the other packages accept: a stable `snapshot` accessor and `subscribe(listener)`. `Fsm`, `FsmHierarchy`, and hierarchy node handles all fit it.

## Configuration validation

The constructor fails fast on:

- empty or whitespace-only `name`
- `initial` state that is not declared in `states`
- `*` used as a state name
- transition source states other than `*` that are not declared in `states`
- transition targets that are not declared in `states`
- `*` used as a transition target
- empty transition definition arrays

Validation covers the state graph only. Value shapes (for example a non-function `guard`) are left to TypeScript; JavaScript callers get a generic `TypeError` when the value is used.

States without outgoing transitions can be omitted from `transitions`, and `*` is optional.

## Companion modules

These capabilities are available as separate packages:

- [`@bazariodev/fsm-effects`](https://www.npmjs.com/package/@bazariodev/fsm-effects): state-entry work, cancellation, and cleanup.
- [`@bazariodev/fsm-delays`](https://www.npmjs.com/package/@bazariodev/fsm-delays): state-scoped timeouts and intervals.
- [`@bazariodev/fsm-hierarchy`](https://www.npmjs.com/package/@bazariodev/fsm-hierarchy): nested machines and event bubbling.
- [`@bazariodev/fsm-react`](https://www.npmjs.com/package/@bazariodev/fsm-react): snapshot, selector, and component-lifecycle hooks.
- [`@bazariodev/fsm-persist`](https://www.npmjs.com/package/@bazariodev/fsm-persist): snapshot storage and restoration by construction.
- [`@bazariodev/fsm-inspect`](https://www.npmjs.com/package/@bazariodev/fsm-inspect): timelines, logging, and Mermaid diagrams.

History, parallel regions, and transport-specific orchestration remain outside the core API.

## License

MIT
