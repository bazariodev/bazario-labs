# @bazariodev/idle-watchdog

A dependency-free, one-shot inactivity timer. Consumers report activity through `arm()` and
decide what to do when `onIdle` fires. The watchdog owns only its timer and subscriptions.

```js
import { IdleWatchdog } from '@bazariodev/idle-watchdog';

const watchdog = new IdleWatchdog({ idleMs: 30_000 });
const unsubscribe = watchdog.onIdle(() => {
  console.log('No activity reported for 30 seconds.');
});

watchdog.arm(); // Start a fresh inactivity window from now.
watchdog.cancel(); // Disarm; arm() can start another idle window.

unsubscribe();
watchdog.stop(); // Terminal; also available as watchdog[Symbol.dispose]().
```

## API

`new IdleWatchdog({ idleMs, scheduler?, logger? })` creates an inert watchdog. `idleMs` is fixed
for the instance and must be an integer from `1` through `2_147_483_647` milliseconds, inclusive
(approximately 24.85 days maximum). Invalid values throw `RangeError` during construction; values
are never clamped or rounded. The same range applies to injected schedulers.

| Method | Behavior |
| --- | --- |
| `arm()` | Start a fresh inactivity window from now, replacing any pending window. |
| `cancel()` | Disarm the timeout without removing listeners. Restartable and idempotent. |
| `onIdle(listener)` | Subscribe and return an idempotent unsubscribe function. |
| `stop()` / `[Symbol.dispose]()` | Disarm, clear listeners, and permanently make operations inert. |

Expiry disarms before notifying, so an idle listener may safely call `arm()` to arm the next
window. Without another `arm()` call, expiry fires only once. Queued callbacks from superseded or
cancelled timers cannot emit or disturb a later window.

Listeners run synchronously in registration order using a snapshot taken at expiry. Subscription
changes affect the next notification; `stop()` also suppresses remaining listeners in the current
notification. Registering the same function twice creates only one subscription, which either
returned unsubscribe can remove. Once removed, its unsubscribe functions cannot remove a later
registration of the same function. Synchronous listener exceptions are logged without blocking
later listeners. Listeners must handle their own asynchronous failures.

## Scheduling and diagnostics

The default scheduler wraps platform `setTimeout` and `clearTimeout`. Validating integer durations
within the range prevents overflow and implicit truncation. Platform scheduling and background-tab
throttling can still delay callbacks; this is not a precise clock or a sleep/wake detector.
Consumers choose any stricter limits appropriate to their resource or protocol.

Tests or alternative runtimes can inject this structural port:

```ts
type TimeoutScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;
```

Scheduler methods must not throw, and callbacks must run asynchronously, as with platform timers.
Handles are opaque. Optional `logger.error(message, metadata?)` receives subscriber failures and
must not throw. Logging defaults to a no-op.

## Composition

The watchdog does not inspect traffic, send pings, close connections, or reconnect. Its consumer
owns arming and expiry policy. `Keepalive` composes two watchdogs internally for inactivity and promise-probe
deadline windows. `RealtimeClient` reports validated incoming traffic to keepalive and handles connection
recovery; it does not directly manage those timers. Other consumers can use a watchdog independently.
Each owner should dispose its watchdog when finished.

The package has no dependency on FSM, keepalive, transport, or React. It ships ESM and CommonJS
runtime exports with public TypeScript declarations.

## Development

```sh
pnpm --filter @bazariodev/idle-watchdog build
pnpm --filter @bazariodev/idle-watchdog test
pnpm --filter @bazariodev/idle-watchdog typecheck
```

MIT — see [LICENSE](./LICENSE).
