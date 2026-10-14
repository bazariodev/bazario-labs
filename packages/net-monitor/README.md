# @bazariodev/net-monitor

`BrowserNetMonitor` reports the browser's online and offline hints. It has no dependencies and does
not start observation until the first subscriber.

## Install

```sh
pnpm add @bazariodev/net-monitor
```

## Usage

```js
import { BrowserNetMonitor } from '@bazariodev/net-monitor';

const monitor = new BrowserNetMonitor();
const unsubscribe = monitor.subscribe((state) => {
  console.log(`Browser network state: ${state}`);
});
```

The application owns `monitor`. Call `unsubscribe()` to remove one listener. Call `monitor.stop()`
when the application no longer needs the monitor.

## Behavior

- `getSnapshot()` returns `online` or `offline`.
- Without subscribers, `getSnapshot()` reads `navigator.onLine`. With subscribers, it returns the
  last observed state. A missing or non-boolean value causes a `TypeError` when the monitor reads it.
- A startup sample of `navigator.onLine === false` reports `offline` before any event.
- The first subscription adds browser `online` and `offline` listeners. The last unsubscribe removes
  them. A later subscription reads the platform state again.
- Each call to `subscribe()` has its own cleanup function, including calls with the same listener.
- Repeated states do not notify listeners. A listener error does not stop other listeners.
- `stop()` is permanent. It removes listeners, keeps the last snapshot, and makes later subscriptions
  inactive.
- Browser online state is a hint. It does not confirm that a server is reachable.

## API

| API | Behavior |
| --- | --- |
| `new BrowserNetMonitor(options?)` | Create a monitor. Construction adds no browser listeners. |
| `getSnapshot()` | Read the current state without subscribing. |
| `subscribe(listener)` | Listen for state changes. Return an idempotent unsubscribe function. |
| `stop()` / `[Symbol.dispose]()` | Remove all listeners and stop the monitor permanently. |

`BrowserNetMonitorOptions.platform` selects a platform port for tests or another host. It must provide
a boolean `navigator.onLine` value. It may also provide `addEventListener` and `removeEventListener`.
`onListenerError` receives errors from listeners and platform listener removal. Errors from listener
attachment are thrown after the monitor releases any listener that it already added.

The source also implements this structural interface:

```ts
type ConnectivityState = 'online' | 'offline';

interface ConnectivitySource {
  getSnapshot(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): () => void;
}
```

## Errors

`getSnapshot()` and `subscribe()` throw `TypeError` when a platform read does not return a boolean.
`subscribe()` also throws `TypeError` when its listener is not a function. The monitor releases a new
registration if its sample fails. A platform error while adding a browser listener is thrown after
partial setup is released. Errors from `navigator` or `onLine` accessors pass through unchanged.
Listener errors go to `onListenerError`; if that callback throws, the monitor contains that error.

## TypeScript

The declarations use no DOM types. The `platform` option uses small structural types, so the package
can type-check in Node, browser, and worker projects.

## License

MIT — see `LICENSE`.
