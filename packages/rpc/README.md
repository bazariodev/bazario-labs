# @bazariodev/rpc

RpcClient sends flat request and notification frames and matches response IDs. It owns bounded waiting, cancellation, response timeouts, and cleanup when the realtime state changes.

## Install

```sh
pnpm add @bazariodev/rpc @bazariodev/realtime @bazariodev/transport
```

RPC has no peer dependencies. It owns its `RpcChannel` type and has one runtime dependency, [`@bazariodev/coordination`](https://www.npmjs.com/package/@bazariodev/coordination). Install RealtimeClient and your selected transport adapter as direct dependencies when you use them.

## Usage

RpcClient uses RealtimeClient directly. Construct both before connecting:

```js
import { createRealtimeClient, JsonTransport } from '@bazariodev/realtime';
import { WebSocketAdapter } from '@bazariodev/transport';
import { RpcClient } from '@bazariodev/rpc';

const realtime = createRealtimeClient({
  createTransport: () => new JsonTransport(
    new WebSocketAdapter({ url: 'wss://example.com/realtime' }),
  ),
});
const rpc = new RpcClient({ channel: realtime });
realtime.connect();

const user = await rpc.request({ method: 'getUserInfo' });
// Validate user with your application schema before use.
```

Application code does not set request IDs. RPC generates a fresh non-empty string for each request.

```js
rpc.onNotification((notification) => handleNotification(notification));
await rpc.notify({ method: 'messageTyped', params: { typing: true } });
// notify resolves when the local write is accepted, not when the server replies.
```

## Behavior

- Requests are `{ id, method, params? }`. Notifications are `{ method, params? }`. Results are `{ id, result }`; errors are `{ id, error }`.
- RPC accepts unknown incoming values at its boundary. It ignores primitives, arrays, binary values, unmatched IDs, and IDs that are not non-empty strings. It does not close the connection or publish invalid frames as notifications.
- Notifications have no ID and keep extra fields such as `ts` and `eventId`. Server-to-client requests are not supported.
- A matched response error rejects `request()` with `RpcResponseError`. `probe()` resolves on either a matched result or a valid matched error. This proves a round trip, not application success or authentication.
- READY and response waits have separate deadlines. Waiting and sent work share a capacity limit. Losing READY rejects sent calls; calls are never replayed.
- Abort, disconnect, reconnect, timeout, and stop release timers, listeners, and IDs. A late response from an old connection cannot settle a later call.
- Realtime owns message transport and state. RPC does not stop or dispose the channel.

## API

| Option | Default | Purpose |
| --- | --- | --- |
| `channel` | required | A RealtimeClient-like object with `state`, `send`, `onMessage`, and snapshot `subscribe`. |
| `createRequestId` | UUID with time/random fallback | Create a fresh ID for each request. Notifications do not use IDs. |
| `timeoutMs` | `10_000` | Positive response timeout in milliseconds. |
| `readyTimeoutMs` | `10_000` | Positive wait for ready state. |
| `maxPending` | `100` | Positive safe integer for waiting and sent operations. |
| `scheduler` | platform timers | Optional asynchronous timer port with opaque handles. |
| `logger` | no-op | Optional error logger for callback failures. |

| Method | Purpose |
| --- | --- |
| `request({ method, params? }, options?)` | Resolve the matched result or reject on server or local failure. |
| `notify({ method, params? }, options?)` | Write without an ID or response wait. |
| `probe(request, options?)` | Resolve on either a matched result or a valid matched server error. |
| `onNotification(listener)` | Observe valid ID-less method frames, including extra server metadata. |
| `stop()` / `[Symbol.dispose]()` | Reject outstanding work and release RPC subscriptions. |

Request options accept `signal`, a response `timeoutMs` override, and `onWillSend`. The hook runs before the write; abort or stop during the hook prevents the write.

## Errors

`RpcResponseError` contains the server error code, optional data, and method. `RpcError.kind` is `aborted`, `timeout`, `disconnected`, `stopped`, `capacity`, `id`, `send`, or `protocol`. Invalid configuration throws `TypeError` or `RangeError`; invalid request values reject their promise.

## TypeScript

Results default to `unknown`. A type argument does not validate a server result. Validate it with your application schema. The package ships ESM and CommonJS declarations. Include `DOM` or `WebWorker` platform types.

## License

MIT. See [LICENSE](./LICENSE).
