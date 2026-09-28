# @bazariodev/transport

A shared interface for one WebSocket, HTTP, or WebTransport connection attempt. Pick an adapter:
`WebSocketAdapter`, `HttpAdapter` (a streaming GET plus POSTs), or `WebTransportAdapter` (one
reliable bidirectional stream). Plain JavaScript with TypeScript declarations and no runtime
dependencies.

## Install

```sh
pnpm add @bazariodev/transport
```

## Usage

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

Call `transport.close()` when you no longer need the connection; `onClose` confirms it. Call
`transport[Symbol.dispose]()` when the owner is torn down, to release everything without further
callbacks.

## Lifecycle

All three adapters follow the same rules:

1. `new …Adapter(options)` creates an idle instance; nothing connects yet.
2. `start(handlers)` connects. Call it once. If the connection can't even be created, `start()`
   throws the original error, and the instance is finished without reporting any events.
3. `onOpen` fires at most once, when the connection is ready.
4. `onMessage` delivers each message, in arrival order.
5. `onClose({ code?, reason?, clean })` fires once, when the attempt ends, unless you dispose the
   instance first. Nothing fires after it.

- `onError` is diagnostic only. The attempt is over only when `onClose` fires.
- `send(message)` either accepts the message into the attempt's bounded buffer and returns, or
  throws. Accepted doesn't mean delivered, and a rejected message isn't queued. If a write fails
  later on HTTP or WebTransport, you get `onError` and then an unclean `onClose`.
- `close()` asks the connection to close. `onClose` follows asynchronously, never from inside
  `close()`. Calling `close()` again does nothing. Calling it before `start()` finishes the instance
  without any events.
- `[Symbol.dispose]()` releases everything immediately and silently; no callbacks fire after it,
  not even a pending `onClose`.
- One instance is one attempt. To reconnect, create a new instance.
- Handlers must not throw; catch errors inside them. What happens after a handler throws depends
  on the adapter.

The adapters handle only the physical connection and local write admission. Handshake,
authentication, reconnects, and liveness belong to the code that owns the logical connection. For
liveness, see [`@bazariodev/keepalive`](https://www.npmjs.com/package/@bazariodev/keepalive).

## Public interface

| Export | Contract |
| --- | --- |
| `Transport` | `start(handlers)`, `send(message)`, `close()`, `[Symbol.dispose]()` |
| `TransportHandlers` | `onOpen`, `onMessage`, `onError`, and `onClose`; all required |
| `TransportMessage` | `string \| Uint8Array` |
| `TransportClose` | `{ code?: number; reason?: string; clean: boolean }` |
| `TransportFactory` | `() => Transport`; returns a fresh attempt |
| `Logger` | `debug`, `warn`, and `error` methods |
| `WebSocketAdapter`, `HttpAdapter`, `WebTransportAdapter` | The adapters, each with an `…Options` type |

Code that manages connections can depend on `TransportFactory` alone, so the application picks the
adapter:

```ts
import { WebSocketAdapter } from '@bazariodev/transport';
import type { TransportFactory } from '@bazariodev/transport';

const createTransport: TransportFactory = () =>
  new WebSocketAdapter({ url: 'wss://example.com/realtime' });
```

## Logging

Pass a `logger`, such as `console`, to any adapter; the default is a no-op. `debug` records starts,
opens, and closes with their close details. `error` records start failures and connection errors
with the original cause. There are no per-message logs. Adapters don't add URLs, headers, or
payloads to log metadata, but the original errors they log may contain them; a native fetch error
can include the full URL and query string. Logger methods must not throw.

## WebSocket

`new WebSocketAdapter(options)` creates an idle adapter; the socket opens at `start()`.

| Option | Meaning |
| --- | --- |
| `url` | Required string, or a function returning one; resolved at `start()` |
| `protocols` | Optional subprotocol string or array |
| `maxBufferedBytes` | Maximum projected browser buffer size, including this write; defaults to 1 MiB |
| `WebSocket` | Optional native-compatible constructor; defaults to the global `WebSocket` |
| `logger` | Optional `Logger`; defaults to a no-op |

- Text arrives as `string` and binary data as `Uint8Array`, in arrival order.
- `send()` throws `Error('Transport is not open.')` before open or once closing starts, and
  `Error('Transport buffer limit exceeded.')` above the buffer limit. Platform write errors are
  thrown unchanged.
- The buffer counts UTF-8 bytes for text and byte length for binary data. A write exactly at the
  limit is accepted.
- `clean` is the platform's `wasClean`, even when you requested the close. Cancelling while
  connecting can report `clean: false` with code `1006`; see the
  [WebSocket close algorithm](https://websockets.spec.whatwg.org/#dom-websocket-close).
- Unsupported incoming data reports `onError`, then closes the attempt.
- Needs `WebSocket`, `TextEncoder`, and `Symbol.dispose`. An injected constructor must create a
  fresh, connecting socket with browser event behavior. Errors from the constructor or the `url`
  function are thrown from `start()`. Importing the package doesn't open connections.

## HTTP

```js
import { HttpAdapter } from '@bazariodev/transport';

const transport = new HttpAdapter({
  // The server uses this ID to pair the GET and POST requests of one attempt.
  url: () => `https://example.com/realtime/${crypto.randomUUID()}`,
  headers: { Authorization: `Bearer ${token}` }, // `token` is yours
  credentials: 'include',
});
// start(handlers), send(message), close(), and disposal work as in the usage example.
```

The URL is resolved once, at `start()`. A streaming GET receives messages; each POST to the same
URL sends one message. This needs a matching server endpoint: it isn't SSE, and it doesn't poll or
reconnect.

The server must:

- Pair the GET and POST requests by the attempt-specific URL.
- Answer the GET with a successful `application/octet-stream` response and flush the headers
  immediately. `onOpen` fires when the response body is available, before the first message.
- Stream frames (see [Message framing](#message-framing)) without proxy buffering, and allow CORS
  for cross-origin use.
- Accept one frame per POST and reply with success, usually `204`, once it's accepted. POSTs are
  sent one at a time, which keeps them in order; their responses don't carry incoming messages.
- End the GET stream to close the attempt.
- Release the attempt's resources when the client aborts the GET.

| Option | Meaning |
| --- | --- |
| `url` | Required string or URL function; the same resolved URL is used for GET and POST |
| `headers` | Optional `HeadersInit` applied to both requests |
| `credentials` | Optional fetch credentials mode; otherwise the platform default applies |
| `maxMessageBytes` | Maximum incoming or outgoing payload size; defaults to 1 MiB |
| `maxBufferedBytes` | Maximum outgoing frame bytes still in flight, headers included; defaults to 1 MiB |
| `fetch` | Optional `(url, init) => Promise<Response>`; defaults to the global `fetch` |
| `logger` | Optional `Logger`; defaults to a no-op |

Requests skip caches and set `Accept: application/octet-stream`; POSTs also set the matching
`Content-Type`. HTTP errors, network failures, and invalid frames report `onError`, then an unclean
`onClose`. When the GET stream ends, the attempt closes cleanly. `close()` aborts the requests,
drops unsent writes, and reports one clean `onClose`. Accepted writes are never retried.

## WebTransport

```js
import { WebTransportAdapter } from '@bazariodev/transport';

const transport = new WebTransportAdapter({
  url: 'https://example.com/realtime',
  sessionOptions: { congestionControl: 'low-latency' },
});
```

`start()` creates a session, waits until it's ready, and opens one reliable bidirectional stream;
`onOpen` fires when the stream is available. The server accepts that stream and exchanges frames on
it in both directions. Datagrams and extra streams aren't used.

| Option | Meaning |
| --- | --- |
| `url` | Required HTTPS URL string, or a function returning one; resolved at `start()` |
| `sessionOptions` | Optional native `WebTransportOptions` passed to the constructor |
| `maxMessageBytes` | Maximum incoming or outgoing payload size; defaults to 1 MiB |
| `maxBufferedBytes` | Maximum outgoing frame bytes still in flight, headers included; defaults to 1 MiB |
| `WebTransport` | Optional native-compatible constructor; defaults to the global `WebTransport` |
| `logger` | Optional `Logger`; defaults to a no-op |

How an attempt ends:

| What happens | Result |
| --- | --- |
| The server closes the session normally | `onClose({ code, reason, clean: true })` with the session's `closeCode` and `reason`; no `onError` |
| The stream ends normally | `onClose({ clean: true })`, without session close details |
| The stream is reset or fails | `onError`, then `onClose({ clean: false })`, even if session details arrive later |
| The session or connection fails | `onError`, then `onClose({ clean: false })` |
| You call `close()` | The stream and session are cancelled, then one clean `onClose` |

Writes go through the stream's own buffer; unsent writes may be dropped on close. Neither `close()`
nor disposal waits for delivery.

WebTransport needs a supporting runtime and a secure context. No other adapter is chosen as a
fallback. The session close, stream reset, and connection failure results were verified with native
Chrome against an HTTP/3 server; the record, `WEBTRANSPORT_CHECK.md`, ships in this package. See
the [WebTransport specification](https://www.w3.org/TR/webtransport/).

## Message framing

HTTP and WebTransport use the same binary framing. WebSocket keeps its native message format.

| Bytes | Meaning |
| --- | --- |
| `0` | Type: `0` = UTF-8 text, `1` = binary |
| `1–4` | Payload length in bytes, unsigned 32-bit big-endian |
| `5…` | Payload bytes |

For example, text `hi` is `[0, 0, 0, 0, 2, 104, 105]` and binary `[1, 2]` is
`[1, 0, 0, 0, 2, 1, 2]`. Empty messages are valid. Stream chunks may split or combine frames; you
still receive complete messages, in order, as text or binary.

Unknown types, invalid UTF-8, oversized payloads, and a frame cut off by the end of the stream fail
the attempt. An outgoing message is accepted only if its payload fits `maxMessageBytes` and its
payload plus the 5-byte header fits the space left in `maxBufferedBytes`. The space frees up as
POSTs or stream writes complete. These limits bound one attempt; they don't provide
acknowledgements, retries, or an outbox.

## TypeScript

Add `"DOM"` (browsers) or `"WebWorker"` (workers) to `compilerOptions.lib`. Node projects need
declarations for every Web API in the public interface, including WebTransport, even if they use
only `WebSocketAdapter` or `HttpAdapter`. Types don't install those APIs: inject implementations
where the runtime lacks them. Since 0.2 the package no longer adds DOM types for you; adapter
behavior is unchanged.

## License

MIT
