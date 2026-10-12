# @bazariodev/realtime

RealtimeClient owns connection intent, readiness, one active connection attempt, and recovery. It passes messages as opaque values. The application selects the transport and any wire format.

## Install

```sh
pnpm add @bazariodev/realtime @bazariodev/transport
```

Realtime has no transport peer dependency. Install the chosen transport adapter as a direct dependency. The root entry uses `@bazariodev/fsm` and `@bazariodev/coordination`; configured Keepalive uses `@bazariodev/keepalive`, which installs `@bazariodev/idle-watchdog`. The `/core` entry has no imports from these default implementation packages.

## Usage

The JSON helper is optional. Use it when the raw adapter sends and receives text frames:

```js
import { createRealtimeClient, JsonTransport } from '@bazariodev/realtime';
import { WebSocketAdapter } from '@bazariodev/transport';

const client = createRealtimeClient({
  createTransport: () => new JsonTransport(
    new WebSocketAdapter({ url: 'wss://example.com/realtime' }),
  ),
});

client.onReady(({ reason }) => {
  console.log('Transport is open:', reason);
  client.send({ method: 'subscribe', params: { topic: 'presence' } });
});
client.connect();
```

`JsonTransport` accepts incoming text frames up to 1,048,576 UTF-8 bytes by default. Set `maxIncomingBytes` to a larger positive safe integer when the application needs larger frames:

```js
const transport = new JsonTransport(rawTransport, { maxIncomingBytes: 2_097_152 });
```

In this example, `rawTransport` is the application's raw adapter.

The factory uses the raw message type unchanged when you omit `JsonTransport`. It does not add a handshake or reserved packet types. `onReady` means the selected transport called `onOpen`; it does not mean that the application is authenticated or synchronized.

### Injected core

Use `RealtimeClient` from `/core` when the application supplies the lifecycle, event publisher, transport factory, retry driver, and monitor factory:

```js
import { RealtimeClient } from '@bazariodev/realtime/core';

const client = new RealtimeClient({
  fsm,
  events,
  createTransport,
  retry,
  createKeepalive: null,
});
```

The required dependencies are `fsm`, `events`, and `createTransport`; `retry` and `createKeepalive` are optional and may be `null`. In this example, `fsm`, `events`, `createTransport`, and `retry` are values supplied by the application. A connection factory returns one fresh object per attempt. If selected, a monitor factory receives that attempt's message port.

The injected lifecycle must start in `idle` with `context.attempt` set to `0`. Its `send(event)` commits and publishes synchronously. It returns a stable snapshot reference for each commit; subscriptions report future commits only. The injected event publisher preserves listener order, isolates listener errors, and returns the same idempotent unsubscribe function for duplicate registrations. Its `stop()` is terminal and makes later registrations inert. Unsubscribe functions must not throw. The transport factory returns a fresh, unstarted attempt each time. The transport must not call handlers before `start()`; `start()` may call handlers synchronously. Transport disposal must be idempotent.

### Probe and RPC

The default Keepalive is created when `keepalive` options are supplied. A `createKeepalive` function selects an application monitor; `createKeepalive: null` omits it. Construct RPC before connecting so the probe can use it:

```js
import { createRealtimeClient, JsonTransport } from '@bazariodev/realtime';
import { WebSocketAdapter } from '@bazariodev/transport';
import { RpcClient } from '@bazariodev/rpc';

let rpc;
const client = createRealtimeClient({
  createTransport: () => new JsonTransport(
    new WebSocketAdapter({ url: 'wss://example.com/realtime' }),
  ),
  keepalive: {
    idleMs: 30_000,
    deadlineMs: 5_000,
    probe: (signal) => rpc.probe({ method: 'ping' }, { signal }),
  },
});
rpc = new RpcClient({ channel: client });
client.connect();
```

A matched RPC error proves that the peer answered. It does not prove authentication or application success. The probe owns its correlation policy.

## Behavior

- The states are `idle`, `connecting`, `ready`, `backoff`, and terminal `stopped`. Only `ready` accepts `send()` and `probeNow()`.
- `connect()` starts from idle. `disconnect()` returns to idle and permits a later connect. `reconnect()` replaces the current attempt. `stop()` ends the client permanently.
- `onReady` reports `initial` until the client first reaches ready. Later ready events report `reconnect`, including after a recoverable disconnect.
- A connection belongs to one attempt. A configured monitor belongs to one ready attempt. The client clears ownership before cleanup and ignores callbacks from retired attempts. It releases the monitor's message subscriptions when the attempt ends, even if the monitor factory fails.
- The newest effective lifecycle command wins. An inert `connect()` does not replace an operation already in progress. Factories run without a receiver. A connection factory must not call handlers before `start()`; `start()` may call handlers synchronously.
- Retry callbacks are asynchronous, including zero delay. The client ignores stale retry callbacks. If `retry: null`, a connection failure returns to idle and a later `connect()` can start again.
- `createKeepalive: null` omits the monitor and its probe. Any server-specific reply behavior belongs to the application's transport or probe integration, whether a monitor is selected or not. There is no special `false` mode.
- `send()` returning `true` means local write admission. It does not mean delivery. Realtime does not queue or replay application messages. The application owns authentication, online state, wake handling, server readiness, and resynchronization.
- `JsonTransport` serializes outgoing values once and parses incoming text once. It skips malformed, non-text, or over-limit input with a warning. The default incoming limit is 1,048,576 UTF-8 bytes. Set `maxIncomingBytes` to a larger positive safe integer when needed. It throws for values that `JSON.stringify` cannot serialize. It does not validate an application schema.
- Realtime does not define a wire envelope, auth packet, connect/ready packet, ping/pong packet, or generated tracing ID.

## API

### Factory options

| Option | Default | Purpose |
| --- | --- | --- |
| `createTransport` | required | Create a fresh transport for each attempt. The transport implements `start`, `send`, and `[Symbol.dispose]`. |
| `fsm` | default FSM | Optional lifecycle with state, snapshot, `send(event)`, and `subscribe(listener)`. |
| `events` | default publisher | Optional event publisher with `on`, `emit`, and terminal `stop`. |
| `retry` | default retry driver | Use `null` to omit retries. A driver schedules a callback and returns cancellation. |
| `createKeepalive` | omitted | Optional per-ready-attempt monitor factory. Use `null` to omit it. |
| `keepalive` | omitted | Create the default Keepalive only when a probe is provided. Requires `idleMs`, `deadlineMs`, and `probe(signal)`. |
| `connectTimeoutMs` | `10_000` | Maximum time to open the transport. Positive integer milliseconds. |
| `reconnect` | defaults | Default retry options: `initialDelayMs`, `maxDelayMs`, `factor`, and ratio `jitter`. |
| `scheduler`, `random`, `logger` | platform defaults | Timer provider, fallback random draw, and diagnostic ports used by selected defaults. |

The default retry driver uses `createBackoffScheduler` from coordination. Attempts are one-based
and belong to the client lifecycle. The default jitter range is `[0, 1)`. Set `reconnect.jitter` to
`false` to skip random draws, or provide `minRatio`, `maxRatio`, and `random`. A nested random
function takes precedence over top-level `random`; when it is omitted, the top-level function is
used. A custom retry driver or `retry: null` does not validate or use default retry options. The
factory shares one timer provider with the connection deadline, default retry driver, and
configured default Keepalive. Direct `/core` construction keeps its native timer fallback.

To inject a timer provider and set jitter:

```js
import { createRealtimeClient } from '@bazariodev/realtime';

const client = createRealtimeClient({
  createTransport,
  scheduler: customScheduler,
  reconnect: {
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    jitter: { minRatio: 0.25, maxRatio: 1, random: Math.random },
  },
});
```

Here, `createTransport` and `customScheduler` are supplied by the application.
Omit `scheduler` to use coordination's `defaultScheduler`.

Only selected defaults validate their own options. A custom transport does not need transport-adapter options. A custom monitor makes the default Keepalive options irrelevant. Explicit `null` does not select a default.

### Methods and events

| Member | Purpose |
| --- | --- |
| `connect()`, `reconnect()`, `disconnect()` | Start, replace, or retire a connection attempt. |
| `send(message)` | Send one opaque message while ready. Returns whether local admission succeeded. |
| `probeNow()` | Ask the active monitor to probe now. |
| `subscribe(listener)` | Observe stable state snapshots. Treat each snapshot and its context as read-only. RPC observes the same terminal snapshot through this subscription. |
| `onReady`, `onMessage`, `onError` | Observe readiness, opaque incoming values, diagnostics, and attempt failure details. |
| `stop()` / `[Symbol.dispose]()` | Stop permanently and release owned resources. |

The transport `onError` callback is diagnostic. It reports an error but does not retire the attempt. The transport `onClose` callback ends the attempt and can start recovery. A failed start, connect timeout, or monitor failure also ends the attempt. `RealtimeClient.onError` reports diagnostics and attempt failure details. A failed local send reports an error and returns `false` without retiring a usable connection. RPC observes the same final stopped snapshot as other client subscribers.

## Errors

The client and default retry options validate during construction. A monitor is built for a ready attempt, so its factory or start can fail later; the client reports the error and applies its recovery policy. A failed local write returns `false` and reports an error. Cleanup errors are logged while cleanup continues.

## TypeScript

The package ships ESM and CommonJS declarations. Include `DOM` or `WebWorker` platform types. `RealtimeClient<TMessage>` and `RealtimeClientDeps<TMessage>` keep the message type paired with the injected transport and monitor.


## License

MIT. See [LICENSE](./LICENSE).
