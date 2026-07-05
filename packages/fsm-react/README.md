# @bazariodev/fsm-react

React bindings for [`@bazariodev/fsm`](https://github.com/Bazariodev/bazario-labs/tree/main/packages/fsm) and any workspace source that exposes the same observation shape: a stable `snapshot` accessor plus `subscribe(listener)`.

Full design rationale: [`React.md` ADR](https://github.com/Bazariodev/bazario-labs/blob/main/.agent/ADR/Modules/React.md).

## Install

```sh
pnpm add @bazariodev/fsm-react @bazariodev/fsm react
```

`react` and `@bazariodev/fsm` are peer dependencies. `@bazariodev/fsm` is used for shared types only; the runtime import is React.

## Usage

```tsx
import { Fsm } from '@bazariodev/fsm';
import { useFsmSelector, useFsmSnapshot } from '@bazariodev/fsm-react';

const call = new Fsm({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0 },
  states: {
    idle: {},
    dialing: {},
    connected: {},
  },
  transitions: {
    idle: { DIAL: { target: 'dialing' } },
    dialing: { CONNECT: { target: 'connected' } },
    connected: {},
    '*': {},
  },
});

function CallState() {
  const snapshot = useFsmSnapshot(call);
  const attempts = useFsmSelector(call, (s) => s.context.attempts);

  return (
    <button type="button" onClick={() => call.send({ type: 'DIAL' })}>
      {snapshot.value} ({attempts})
    </button>
  );
}
```

## API

```ts
function useFsmSnapshot<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
): TSnapshot;

function useFsmSelector<TSnapshot, TSelected>(
  source: FsmSubscribable<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  isEqual?: (a: TSelected, b: TSelected) => boolean,
): TSelected;

function useFsm<TMachine extends FsmSubscribable<unknown>>(
  create: () => TMachine,
  options?: {
    attach?: (machine: TMachine) => void | (() => void);
    teardown?: (machine: TMachine) => void;
  },
): Readonly<{ machine: TMachine; snapshot: SnapshotOf<TMachine> }>;
```

`useFsmSnapshot` and `useFsmSelector` are built on React's `useSyncExternalStore`, so they are safe for concurrent rendering. Sources must return the same `snapshot` reference between commits. A source that allocates a fresh object on every `snapshot` read violates the port contract.

`useFsmSelector` does not resubscribe when inline `selector` or `isEqual` functions change. It does recompute against the current snapshot when those function identities change, so prop-driven selector changes do not return stale data.

## Component-owned machines

`useFsm` is for machines whose lifetime belongs to a component:

```tsx
import { FsmEffects } from '@bazariodev/fsm-effects';
import { useFsm } from '@bazariodev/fsm-react';

function LocalCall() {
  const { machine, snapshot } = useFsm(() => createCallMachine(), {
    attach: (machine) => {
      const effects = new FsmEffects(machine, {
        effects: {
          dialing: () => {
            // start state-entry work
          },
        },
      });

      return () => effects.stop();
    },
  });

  return (
    <button type="button" onClick={() => machine.send({ type: 'DIAL' })}>
      {snapshot.value}
    </button>
  );
}
```

React StrictMode can call state initializers twice in development. Because `useFsm` creates machines in a lazy state initializer, `create` must be discard-safe: constructor-time hooks such as initial `onEnter` or hierarchy `onNodeSpawned` should stay registration-only and resource-free. Acquire sockets, timers, runners, and other external resources in `attach`, and release them through the returned cleanup or `teardown`.

If `teardown` is provided, a machine is considered dead after teardown runs. StrictMode's development effect replay will create a fresh instance instead of reattaching to the dead one, so dev builds may briefly reset component-owned machines to their initial state. Machines that must not reset should live outside the component and be consumed with `useFsmSnapshot` or `useFsmSelector`.

## Method binding

`Fsm.send` and `FsmHierarchy.send` are class prototype methods. Call them as `machine.send(event)` or wrap them in a handler. Hierarchy node handles are closure-based and can be detached safely.

The hooks wrap `source.subscribe` and `source.snapshot` in closures internally, so class-based sources work without consumers binding methods manually.

## SSR and RSC

The package passes `source.snapshot` as `getServerSnapshot`, so server rendering can produce initial markup. Hydration consistency is the consumer's responsibility: the first client snapshot must match the server-rendered snapshot.

Distributed files include a `'use client'` directive banner.

## License

MIT
