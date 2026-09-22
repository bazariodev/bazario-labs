# @bazariodev/transport

One package for the shared transport contract and its platform adapters. Each transport instance
represents one ordered duplex connection attempt. The implementation is plain JavaScript, with
TypeScript declarations for the public interface and no runtime dependencies.

Choose `WebSocketAdapter`, `HttpAdapter` (streaming GET + POST), or `WebTransportAdapter`
(one reliable bidirectional stream). All three use the same interface.

```js
import { WebSocketAdapter } from '@bazariodev/transport';

const transport = new WebSocketAdapter({
  url: 'wss://example.com/realtime',
  protocols: 'bazario.realtime.v1',
});

transport.start({
  onOpen() {
    try {
      transport.send('hello');
    } catch (cause) {
      console.error('Write rejected:', cause);
    }
  },
  onMessage(message) {
    console.log('Received:', message);
  },
  onError(cause) {
    console.error('Connection diagnostic:', cause);
  },
  onClose({ code, reason, clean }) {
    console.log('Closed:', { code, reason, clean });
  },
});
```

Call `transport.close()` when the connection is no longer needed; `onClose` reports completion.
Call `transport[Symbol.dispose]()` when its owner is torn down to release it without further callbacks.

## Public interface

| Export | Contract |
| --- | --- |
| `TransportMessage` | `string \| Uint8Array` |
| `Logger` | Optional injected `debug`, `warn`, and `error` methods |
| `TransportClose` | `{ code?: number; reason?: string; clean: boolean }` |
| `TransportHandlers` | Required `onOpen`, `onMessage`, `onError`, and `onClose` callbacks |
| `Transport` | `start(handlers)`, `send(message)`, `close()`, `[Symbol.dispose]()` |
| `TransportFactory` | `() => Transport`; returns a fresh attempt |
| `WebSocketAdapter` | Browser WebSocket implementation of `Transport` |
| `WebSocketAdapterOptions` | URL, subprotocols, buffer limit, and injectable WebSocket constructor |
| `HttpAdapter` | Streaming GET for incoming messages, sequential POSTs for outgoing messages |
| `HttpAdapterOptions` | URL, headers, credentials, size limits, and injectable fetch |
| `WebTransportAdapter` | One WebTransport session with one reliable bidirectional stream |
| `WebTransportAdapterOptions` | URL, native session options, size limits, and injectable WebTransport constructor |

- Call `start()` once. It may throw if the platform connection cannot be constructed.
- A synchronous `start()` failure is terminal and silent: the original error is rethrown, a later
  `close()` emits no event, and the instance cannot be started again.
- Handlers must not throw; an exception from a handler has adapter-specific effects.
- `onOpen` fires at most once; messages retain their arrival order.
- `onError` is diagnostic. Only `onClose` marks the attempt as terminal.
- `send()` returns normally with no value when the adapter accepts a local write into the current
  attempt's bounded buffer, and throws when it cannot. Acceptance does not guarantee remote delivery.
  Rejected messages are not queued. Later HTTP/WebTransport write failures report `onError` followed
  by an unclean `onClose`.
- `close()` is idempotent and requests closure while connecting or open. A successfully started
  attempt emits one `onClose`, unless it is disposed before that event arrives. The callback is never
  delivered synchronously from `close()`, and disposal suppresses a pending notification.
- Calling `close()` before `start()` is terminal and silent; the instance cannot be started afterward.
- Disposal is terminal and idempotent: release resources and suppress further callbacks.
- No callback fires after terminal close or disposal. Create a new instance for another attempt.

The owner of the logical connection supplies handshake, authentication, reconnect, and liveness
policy. Adapters handle only the physical connection and local write admission.

## Logging

Pass `logger` to any adapter. It uses the same interface as the other Bazario packages:

```ts
type Logger = {
  debug(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};
```

```js
const transport = new WebSocketAdapter({
  url: 'wss://example.com/realtime',
  logger: console,
});
```

Logging defaults to no-op. `debug` records start attempts, opens, and delivered closes with their
close metadata. `error` records synchronous start failures and connection diagnostics with the
original cause. Messages identify the adapter. `warn` is part of the shared logger interface but
is currently unused. Logger methods must not throw.

There are no per-message logs, and adapters do not add URLs, headers, or message payloads to log
metadata. Synchronous `send()` rejections remain the caller's responsibility. Disposal suppresses
pending and future callback logs along with the callbacks themselves.

## WebSocket options

`new WebSocketAdapter(options)` creates an unstarted adapter. It opens the socket at `start(handlers)`.

| Option | Meaning |
| --- | --- |
| `url` | Required string or function returning a string; resolved at `start()` |
| `protocols` | Optional subprotocol string or array |
| `maxBufferedBytes` | Maximum projected browser buffer size, including this write; defaults to 1 MiB |
| `WebSocket` | Optional native-compatible constructor; defaults to global `WebSocket` |
| `logger` | Optional `Logger`; defaults to no-op |

An injected constructor must create a fresh, connecting WebSocket with normal browser event semantics.
Constructor and URL-resolution exceptions propagate from `start()`.

- Text is delivered as `string`; incoming binary data is delivered as `Uint8Array`, in arrival order.
- `send()` throws `Error('Transport is not open.')` before open or during/after close and
  `Error('Transport buffer limit exceeded.')` above the local buffer limit. Platform write errors
  propagate unchanged. It never queues a rejected write.
- Buffer admission counts UTF-8 bytes for text and the view's byte length for binary data. A write
  exactly at the configured limit is accepted.
- Platform error events are diagnostic. Synchronous write failures are thrown to the caller, not
  emitted through `onError`. The platform close event provides the terminal close metadata.
- `clean` preserves the platform's `wasClean` value even for a local close. Canceling while connecting
  can therefore report `clean: false` and code `1006`; local intent does not mean a closing handshake
  completed. See the [WebSocket close algorithm](https://websockets.spec.whatwg.org/#dom-websocket-close).
- Unsupported incoming data reports an error and requests closure.

Use the adapter in an environment with browser WebSocket, TextEncoder, and Symbol.dispose support,
or inject a browser-compatible WebSocket constructor. Importing the package does not open connections.

## HTTP

```js
import { HttpAdapter } from '@bazariodev/transport';

const transport = new HttpAdapter({
  // The server uses this ID to pair the GET and POST requests for one attempt.
  url: () => `https://example.com/realtime/${crypto.randomUUID()}`,
  headers: { Authorization: `Bearer ${token}` },
  credentials: 'include',
});
// transport.start(handlers), send(message), close(), and disposal work as above.
```

The URL is resolved once at `start()`. A streaming GET receives framed messages; each POST to the
same URL carries one outgoing frame. This requires a matching server endpoint, not an arbitrary
HTTP or SSE endpoint. There is no polling or automatic reconnection.

The server must:

- Associate GET and POST requests using the attempt-specific URL.
- Return a successful GET response with an `application/octet-stream` body and flush headers
  immediately. `onOpen` fires when the response body becomes available, before the first message.
- Stream the frames described below without proxy buffering. Configure CORS for cross-origin use.
- Accept one frame per POST and respond successfully after accepting it (usually `204`). POSTs run
  sequentially so message order is preserved; responses do not carry incoming transport messages.
- End the GET stream to close the attempt and release its server-side resources when it is aborted.

| Option | Meaning |
| --- | --- |
| `url` | Required string or URL function; the same resolved URL is used for GET and POST |
| `headers` | Optional `HeadersInit` applied to both requests |
| `credentials` | Optional fetch credentials mode; otherwise the platform default applies |
| `maxMessageBytes` | Maximum incoming/outgoing payload size; defaults to 1 MiB |
| `maxBufferedBytes` | Maximum outstanding outgoing frame bytes; defaults to 1 MiB |
| `fetch` | Optional `(url, init) => Promise<Response>`; defaults to global `fetch` |
| `logger` | Optional `Logger`; defaults to no-op |

Requests bypass caches and set `Accept: application/octet-stream`; POST also sets the matching
`Content-Type`. HTTP errors, network failures, and invalid incoming frames report `onError` and close
the attempt uncleanly. GET EOF closes cleanly. Local close aborts GET/POST, discards pending writes,
and schedules one clean `onClose`; disposal does the same silently. Accepted writes are never retried.

## WebTransport

```js
import { WebTransportAdapter } from '@bazariodev/transport';

const transport = new WebTransportAdapter({
  url: 'https://example.com/realtime',
  sessionOptions: { congestionControl: 'low-latency' },
});
```

The adapter creates a session at `start()`, waits for `ready`, and opens one reliable bidirectional
stream. `onOpen` fires when that stream is available. The server accepts this client-created stream
and exchanges the frames below in both directions. Datagrams and additional streams are not used.

| Option | Meaning |
| --- | --- |
| `url` | Required HTTPS URL string or function resolved at `start()` |
| `sessionOptions` | Optional native `WebTransportOptions` passed to the constructor |
| `maxMessageBytes` | Maximum incoming/outgoing payload size; defaults to 1 MiB |
| `maxBufferedBytes` | Maximum outstanding outgoing frame bytes; defaults to 1 MiB |
| `WebTransport` | Optional native-compatible constructor; defaults to global `WebTransport` |
| `logger` | Optional `Logger`; defaults to no-op |

Writes use the native ordered stream buffer. Session or stream failures report `onError` and an
unclean `onClose`. Normal stream EOF ends the attempt; normal session closure maps `closeCode` and
`reason` into the transport close event. Errors with `source: 'session'` are handled by the existing
`session.closed` listener, preserving the session's result when closure also errors its streams.
A stream-specific failure or EOF still ends the attempt immediately; later session metadata is not
delivered. There is no timer to collect it. Local close cancels the stream and session and schedules
one clean close; disposal is silent. Pending writes may be discarded on close; neither operation waits
for remote delivery.

Native WebTransport requires a supporting runtime and secure context. No adapter is selected as a
fallback automatically. See the [WebTransport specification](https://www.w3.org/TR/webtransport/).

## Stream message format

HTTP and WebTransport use identical binary framing. WebSocket retains its native message format.

| Bytes | Meaning |
| --- | --- |
| `0` | Type: `0` = UTF-8 text, `1` = binary |
| `1–4` | Unsigned 32-bit, big-endian payload byte length |
| `5…` | Payload bytes |

For example, text `hi` is `[0, 0, 0, 0, 2, 104, 105]`; binary `[1, 2]` is
`[1, 0, 0, 0, 2, 1, 2]`. Empty messages are valid. Stream chunks may split or combine frames;
consumers still receive complete messages in order, preserving text versus binary.

Unknown types, invalid UTF-8, oversized payloads, and incomplete frames at EOF fail the attempt.
Both limits must admit an outgoing message: its payload must fit `maxMessageBytes`, and its payload
plus the five-byte header must fit the remaining `maxBufferedBytes`. Buffer space becomes available
again when POSTs or stream writes complete. These limits bound one attempt; they do not provide
application acknowledgements, retries, or an outbox.

## Composition

Consumers choose the adapter; connection owners depend only on the shared interface:

```ts
import { WebSocketAdapter } from '@bazariodev/transport';
import type { TransportFactory } from '@bazariodev/transport';

const createTransport: TransportFactory = () =>
  new WebSocketAdapter({ url: 'wss://example.com/realtime' });
```

All adapters use the same package entry point. Create a new instance for each connection attempt.
The connection owner handles connecting timeouts, handshake, liveness, and reconnects.

## Validation

`pnpm --filter @bazariodev/transport test` tests observable callbacks, accepted/rejected writes,
outgoing data, framing, and resource closure against injected platform doubles and standard Web
Streams. An HTTP integration test exchanges frames with a local server using native fetch. Tests
do not access adapter internals. `typecheck` compiles public consumer-interface examples, including
rejected inputs. [Native WebTransport verification](./WEBTRANSPORT_CHECK.md) records the real Chrome
and HTTP/3 server check for close metadata, stream resets, and connection loss.

The package ships ESM and CommonJS with matching `.d.ts` and `.d.cts` files. The public platform types
reference the standard DOM and disposable libraries. Importing these declarations also adds DOM
globals to Node-only TypeScript consumers; no custom platform type shims are provided.

## License

MIT.
