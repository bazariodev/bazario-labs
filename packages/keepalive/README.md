# @bazariodev/keepalive

Keepalive runs one abortable liveness probe after a quiet period. It owns idle and response timers. The connection owner decides what to do after failure.

## Install

```sh
pnpm add @bazariodev/keepalive
```

Keepalive has no peer dependencies. It installs [`@bazariodev/idle-watchdog`](https://www.npmjs.com/package/@bazariodev/idle-watchdog) as a runtime dependency.

## Usage

```js
import { Keepalive } from '@bazariodev/keepalive';

const keepalive = new Keepalive({
  idleMs: 30_000,
  deadlineMs: 5_000,
  probe: async (signal) => {
    await checkPeer(signal);
  },
});

keepalive.onFail((failure) => connectionOwner.retire(failure));
keepalive.start();
```

`checkPeer` is an application function. It must reject when it cannot confirm a response. Call `activity()` for validated incoming traffic. Stop the monitor when its connection ends. Create a new instance for each connection.

## Behavior

- Construction is inert. `start()` arms the first idle timer.
- `activity()` resets the idle timer only while started and no probe is active.
- `probeNow()` starts a probe at once. Repeated calls coalesce while a probe is active.
- The probe receives a fresh `AbortSignal`. The fixed `deadlineMs` is not extended by activity.
- Fulfillment resumes idle monitoring. Rejection, timeout, or an invalid duration draw stops the instance and publishes one failure.
- `stop()` is terminal and idempotent. It cancels timers and aborts active work. Late promise results have no effect.
- Keepalive does not parse packets, create IDs, answer peer pings, retry, or replace connections. The probe owns its request format and response matching.
- A probe can use `RpcClient.probe()`. A matched server error proves a round trip, but it does not prove that the application operation succeeded.

## API

| Option | Default | Purpose |
| --- | --- | --- |
| `probe` | required | `(signal: AbortSignal) => Promise<void>`. Fulfill only after the required response arrives. |
| `idleMs` | required | Positive integer milliseconds or a function that returns one duration for each idle window. |
| `deadlineMs` | required | Fixed positive integer response duration in milliseconds. |
| `scheduler` | platform timers | Optional `KeepaliveScheduler` with opaque timer handles. |
| `logger` | no-op | Optional non-throwing error logger. |

| Method | Purpose |
| --- | --- |
| `start()` | Start once. Later calls do nothing. |
| `activity()` | Reset the idle timer when no probe is active. |
| `probeNow()` | Start a probe now when started and idle. |
| `onFail(listener)` | Observe the terminal `{ type: 'timeout' }` or `{ type: 'error', error }` result. |
| `stop()` / `[Symbol.dispose]()` | Stop permanently and release owned work. |

Here, `connectionOwner` is an application-supplied helper that retires the current attempt. Durations must be integer milliseconds from 1 through 2,147,483,647. Scheduler methods and returned unsubscribe functions must not throw. Failure listeners are isolated; one listener error does not stop delivery to later listeners.

## Errors

Invalid options throw `TypeError` or `RangeError` during construction. A probe rejection or invalid duration draw produces `{ type: 'error', error }`. A missed deadline produces `{ type: 'timeout' }`. Keepalive reports failure once and does not choose a recovery action.

## TypeScript

The package ships ESM and CommonJS declarations. Include `DOM` or `WebWorker` platform types. Public types include `KeepaliveOptions`, `KeepaliveProbe`, `KeepaliveFailure`, `KeepaliveScheduler`, `KeepaliveLogger`, and `Unsubscribe`.

## License

MIT. See [LICENSE](./LICENSE).
