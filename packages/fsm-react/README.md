# @bazariodev/fsm-react

React hooks for [`@bazariodev/fsm`](https://www.npmjs.com/package/@bazariodev/fsm) machines. They
work with `Fsm`, `FsmHierarchy`, hierarchy node handles, or any object with a stable `snapshot` and a
`subscribe(listener)` method.

## Install

```sh
pnpm add @bazariodev/fsm-react @bazariodev/fsm react
```

Supports React 18 and 19. `react` and `@bazariodev/fsm` are peer dependencies; `@bazariodev/fsm`
provides the shared types.

## Usage

```tsx
import { Fsm } from '@bazariodev/fsm';
import { useFsmSelector, useFsmSnapshot } from '@bazariodev/fsm-react';

type CallState = 'idle' | 'dialing' | 'connected';
type CallEvent = { type: 'DIAL' } | { type: 'CONNECT' };

const call = new Fsm<CallState, CallEvent, { attempts: number }>({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0 },
  states: { idle: {}, dialing: {}, connected: {} },
  transitions: {
    idle: {
      DIAL: { target: 'dialing', reducer: (context) => ({ attempts: context.attempts + 1 }) },
    },
    dialing: { CONNECT: { target: 'connected' } },
  },
});

function CallButton() {
  const snapshot = useFsmSnapshot(call);
  const attempts = useFsmSelector(call, (s) => s.context.attempts);

  return (
    <button type="button" onClick={() => call.send({ type: 'DIAL' })}>
      {snapshot.value} ({attempts})
    </button>
  );
}
```

Components re-render only after a committed transition; rejected events don't cause renders. Send
events from event handlers or effects, never during render.

## Hooks

```ts
function useFsmSnapshot<TSnapshot>(source: FsmSubscribable<TSnapshot>): TSnapshot;

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

- The hooks use React's `useSyncExternalStore`, so they're safe for concurrent rendering.
- A source must return the same `snapshot` object until its next commit. All Bazario machines do;
  a custom source that builds a new object on every read breaks the hooks.
- `selector` must be pure. Inline selectors are fine: changing `selector` or `isEqual` recomputes
  the value without resubscribing.
- A component re-renders only when `isEqual` (default `Object.is`) reports a change in the selected
  value. A selector that builds a new object or array on every call needs an `isEqual`, such as a
  shallow compare, or the component re-renders on every commit.
- Types: `FsmSubscribable`, `EqualityFn`, `UseFsmOptions`, `SnapshotOf`.

## Machines owned by a component

`useFsm` creates a machine for one component and ties its lifetime to that component:

```tsx
import { FsmEffects } from '@bazariodev/fsm-effects';
import { useFsm } from '@bazariodev/fsm-react';

// `createCallMachine` is your own factory that returns an Fsm.
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

- `create` runs once, on the first render. Passing new `create`, `attach`, or `teardown` functions
  on later renders doesn't recreate or reattach the machine.
- `attach` runs after mount. Its returned cleanup runs on unmount.
- `teardown` runs after that cleanup and ends the machine for good. Machines that own resources need
  it, for example `teardown: (hierarchy) => hierarchy.stop()` for an `FsmHierarchy`.
- In development, React StrictMode may call `create` twice and discard one machine. Keep hooks that
  run during construction (the initial `onEnter`, `onNodeSpawned`) free of side effects, and acquire
  sockets, timers, and runners in `attach`.
- **With `teardown`, StrictMode resets the machine once in development.** StrictMode runs cleanup
  and setup again right after mount. After `teardown` the old machine is dead, so `useFsm` creates a
  fresh one at its initial state. Production doesn't do this. If a machine must never reset, create
  it outside the component and read it with `useFsmSnapshot` or `useFsmSelector`.

## Calling `send`

`Fsm.send` and `FsmHierarchy.send` are class methods, so a detached reference such as
`onClick={machine.send}` throws. Call `machine.send(event)`, or wrap it:
`onClick={() => machine.send(event)}`. Hierarchy node handles can be detached safely. The hooks
never detach your source's methods, so class-based sources work as they are.

## Slow renders

Store updates always render synchronously: wrapping `send` in `startTransition` doesn't make the
re-render non-blocking. To keep input responsive while a slow part of the tree catches up, defer the
value you pass to it:

```tsx
import { memo, useDeferredValue } from 'react';

type Message = { id: string; text: string };

// `chat` is your machine, with a `messages` array in its context.
function Conversation() {
  const messages = useFsmSelector(chat, (s) => s.context.messages);
  const deferredMessages = useDeferredValue(messages);
  return <MessageList messages={deferredMessages} />;
}

// Deferring only helps if the slow component skips renders for unchanged props.
const MessageList = memo(function MessageList({ messages }: { messages: readonly Message[] }) {
  return (
    <ul>
      {messages.map((message) => (
        <li key={message.id}>{message.text}</li>
      ))}
    </ul>
  );
});
```

## Server rendering

The server renders the machine's current snapshot (`getServerSnapshot` reads `source.snapshot`).

- Don't share a module-level machine between requests. Create one per request; `useFsm` does this,
  because each server render creates its own instance.
- The first client render must show the same state as the server. A machine created from the same
  config does. If the server advanced its machine before rendering, pass its final state to the
  client and use it as the client machine's `initial` and `context`.

In apps that use React Server Components, call these hooks from a Client Component: add
`'use client'` to your component's module when needed. The package's own files also start with
`'use client'`, but that marks only the package's modules; it doesn't turn the component that
imports them into a Client Component.

## License

MIT
