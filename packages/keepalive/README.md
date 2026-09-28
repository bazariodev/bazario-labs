# @bazariodev/keepalive

Detects a dead connection. When no validated incoming traffic arrives for `idleMs`, Keepalive runs
your probe (for example a ping) and gives it `deadlineMs` to succeed. If the probe times out or
fails, Keepalive stops and tells you once. You write the probe; Keepalive owns the timing.

## Install

```sh
pnpm add @bazariodev/keepalive
```

`@bazariodev/idle-watchdog` is installed with it automatically.

## Usage

This example wires Keepalive to a
[`@bazariodev/transport`](https://www.npmjs.com/package/@bazariodev/transport) connection. Transport
isn't a dependency of Keepalive, so install it for the example:

```sh
pnpm add @bazariodev/transport
```

```js
import { Keepalive } from '@bazariodev/keepalive';
import { WebSocketAdapter } from '@bazariodev/transport';

const transport = new WebSocketAdapter({ url: 'wss://example.com/realtime' });

const keepalive = new Keepalive({
  idleMs: 30_000,
  deadlineMs: 5_000,
  probe: (signal) => pingOnce(transport, signal),
});

keepalive.onFail((failure) => {
  // Keepalive has already stopped and aborted the pending probe.
  console.warn('Connection lost:', failure);
  transport.close(); // then reconnect with a new transport and a new Keepalive
});

transport.start({
  onOpen: () => keepalive.start(), // start once the connection is ready (after any handshake)
  onMessage: (message) => {
    if (!isValid(message)) return;
    keepalive.activity(); // only validated incoming traffic counts
    route(message); // a pong settles pingOnce's promise
  },
  onError: (cause) => console.warn(cause),
  onClose: () => keepalive.stop(),
});
```

`pingOnce`, `isValid`, and `route` are yours. `pingOnce` sends one ping and returns a promise that:

- registers its pong matcher before sending;
- resolves only after the matching pong arrives on this connection and passes validation;
- rejects if the ping can't be sent, for example when `transport.send` throws;
- removes its matcher when it settles or when `signal` aborts (a successful probe's signal is
  never aborted);
- never retries or adds a timeout of its own.

## Behavior

- Construction doesn't start anything. `start()` begins the first idle window; calling it again
  does nothing. Before `start()` and after Keepalive stops, `activity()` and `probeNow()` do nothing.
- `activity()` restarts the idle window. Report only validated incoming traffic: outgoing writes
  prove nothing about the peer.
- When the idle window ends, Keepalive calls the probe. While a probe is pending, only its deadline
  runs; `activity()` doesn't extend it.
- `probeNow()` runs a probe right away, for example after the device wakes up. While a probe is
  pending, extra calls are ignored.
- When the probe fulfills, the deadline is cancelled and a new idle window starts.
- On a timeout, a rejection, or a probe that throws, Keepalive aborts the probe's `signal`, stops
  for good, then calls `onFail` listeners once with `{ type: 'timeout' }` or
  `{ type: 'error', error }`. A probe that settles later is ignored.
- `stop()` does the same cleanup silently, without calling `onFail`. After a failure or `stop()`,
  create a new instance to monitor again.
- The probe must return a promise that settles only after the real response is validated. An
  `async` function that starts a request without awaiting it fulfills too early, and Keepalive can't
  detect that. A probe that isn't a function, or doesn't return a promise, is reported as an `error`
  failure when it runs.
- Subscribe before `start()`: a failure isn't replayed to later subscribers. Listeners run
  synchronously, in registration order, and the same function registered twice counts once.
  Unsubscribing or calling `stop()` during delivery doesn't cancel it. A listener that throws is
  logged, and the others still run.
- Timers can fire late when the event loop is busy, the tab is throttled, or the device sleeps.

## API

`new Keepalive({ idleMs, deadlineMs, probe, scheduler?, logger? })` creates a monitor that isn't
started yet. Both durations and the probe are required; there are no default timings and no
built-in request protocol. Invalid durations throw `RangeError`.

| Option | Meaning |
| --- | --- |
| `idleMs` | Inactivity window before the probe runs; an integer from `1` to `2_147_483_647` milliseconds. |
| `deadlineMs` | Time the probe has to fulfill, with the same bounds; incoming traffic never extends it. |
| `probe` | `(signal: AbortSignal) => Promise<void>`; fulfill after verifying this connection, reject on failure. |
| `scheduler` | Optional `{ setTimeout, clearTimeout }`, shared by both timers; defaults to the platform timers. Methods must not throw or call back into Keepalive, and callbacks must run asynchronously. |
| `logger` | Optional `{ error(message, metadata?) }` for listener exceptions; must not throw. Defaults to a no-op. |

| Method | Behavior |
| --- | --- |
| `start()` | Begin idle monitoring. Calling it again doesn't extend the current window. |
| `activity()` | Report validated incoming traffic; restarts the idle window unless a probe is pending. |
| `probeNow()` | After `start()`, check right away; ignored while a probe is pending. |
| `onFail(listener)` | Subscribe to the one terminal failure; returns an unsubscribe function. |
| `stop()` / `[Symbol.dispose]()` | Abort pending work and dispose, silently. |

Types: `KeepaliveOptions`, `KeepaliveProbe`, `KeepaliveFailure`, `KeepaliveScheduler`,
`KeepaliveLogger`, `Unsubscribe`.

## TypeScript

Add `"DOM"` (browsers) or `"WebWorker"` (workers) to `compilerOptions.lib`, or use Node typings that
provide `AbortSignal`. The package doesn't add DOM types for you. It's plain JavaScript, shipped as
ESM and CommonJS with TypeScript declarations.

## License

MIT
