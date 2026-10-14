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

- `getSnapshot()` returns `online`, `offline`, or `unknown`.
- Without subscribers, `getSnapshot()` reads `navigator.onLine`. With subscribers, it returns the
  last observed state. It reports `unknown` when the value is not available.
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

`BrowserNetMonitorOptions.platform` selects a platform port for tests or another host. It may provide
`navigator.onLine`, `addEventListener`, and `removeEventListener`. `onListenerError` receives errors
from listeners and platform listener removal. Errors from listener attachment are thrown after the
monitor releases any listener that it already added.

The source also implements this structural interface:

```ts
type ConnectivityState = 'online' | 'offline' | 'unknown';

interface ConnectivitySource {
  getSnapshot(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): () => void;
}
```

## Errors

`subscribe()` throws `TypeError` when its listener is not a function. A platform error while adding
a browser listener is thrown after partial setup is released. Listener errors go to
`onListenerError`; if that callback throws, the monitor contains that error.

## TypeScript

The declarations use no DOM types. The `platform` option uses small structural types, so the package
can type-check in Node, browser, and worker projects.

## License

MIT — see `LICENSE`.
