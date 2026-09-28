# @bazariodev/idle-watchdog

A one-shot inactivity timer with no dependencies. Call `arm()` whenever there's activity; if
`idleMs` passes without another `arm()`, your `onIdle` listeners run. What to do then is up to you.

## Install

```sh
pnpm add @bazariodev/idle-watchdog
```

## Usage

```js
import { IdleWatchdog } from '@bazariodev/idle-watchdog';

const watchdog = new IdleWatchdog({ idleMs: 30_000 });
watchdog.onIdle(() => console.log('No messages for 30 seconds.'));

// `socket` is yours. Each message starts a fresh 30-second window.
const onMessage = () => watchdog.arm();
socket.addEventListener('message', onMessage);
watchdog.arm(); // start the first window now
```

To pause, call `watchdog.cancel()`; the next `arm()` starts a new window. To remove a single
`onIdle` listener, call the function `onIdle` returns.

When you're done, remove your own activity listener and stop the watchdog:

```js
socket.removeEventListener('message', onMessage);
watchdog.stop(); // or watchdog[Symbol.dispose]()
```

`stop()` disarms the watchdog and removes every `onIdle` listener for good. It doesn't touch your
socket listener, which is why the example removes it first.

## API

`new IdleWatchdog({ idleMs, scheduler?, logger? })` creates a watchdog that isn't armed yet.
`idleMs` is fixed for the instance and must be an integer from `1` to `2_147_483_647` milliseconds
(about 24.85 days). Other values throw `RangeError`; they're never clamped or rounded. Injecting a
scheduler doesn't change the allowed range.

| Method | Behavior |
| --- | --- |
| `arm()` | Start a fresh inactivity window from now, replacing any pending window. |
| `cancel()` | Disarm the timeout without removing listeners. Restartable and idempotent. |
| `onIdle(listener)` | Subscribe and return an idempotent unsubscribe function. |
| `stop()` / `[Symbol.dispose]()` | Disarm, clear listeners, and make every later call do nothing. |

- Expiry fires once per `arm()`. The watchdog disarms before notifying, so a listener may call
  `arm()` to start the next window.
- A timer from a cancelled or replaced window never reaches the listeners.
- Listeners run synchronously, in registration order. Adding or removing listeners during a
  notification affects the next one; `stop()` also skips the remaining listeners of the current one.
- Registering the same function twice creates one subscription. Either returned unsubscribe function
  removes it, and neither removes a later registration of that function.
- A listener that throws is reported to `logger.error`, and the other listeners still run.
  Asynchronous failures inside listeners are yours to handle.

## Scheduling

The default scheduler wraps the platform `setTimeout` and `clearTimeout`. Timers can fire late
(busy event loops, background-tab throttling, and sleep all delay them), so this isn't a precise
clock or a sleep detector. Pick limits stricter than the allowed range if your protocol needs them.

Inject a scheduler for tests or other runtimes:

```ts
type TimeoutScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;
```

Scheduler methods must not throw, and callbacks must run asynchronously, as platform timers do.
Handles are opaque. `logger` is optional, needs only `error(message, metadata?)`, and must not
throw; it defaults to a no-op.

## Composition

The watchdog doesn't inspect traffic, send pings, close connections, or reconnect. For connection
liveness, use [`@bazariodev/keepalive`](https://www.npmjs.com/package/@bazariodev/keepalive), which
builds on this package. Stop each watchdog when its owner is done with it.

The package has no dependency on FSM, Keepalive, Transport, or React. It ships ESM and CommonJS with
TypeScript declarations.

## License

MIT
