# ADR: Transport Contract and Platform Adapters

- Status: Accepted
- Date: 2026-07-06
- Revised: 2026-09-22

## Context

R2 needs a realtime client, but `RealtimeClient` should not be coupled to the browser `WebSocket`
class. Bazario's package direction is ports and adapters: domain behavior depends on a small contract,
while platform- or vendor-specific code implements it.

The earlier draft put too much behavior in `transport`. Its `ManagedConnection` also owned an FSM,
reconnect backoff, heartbeat, offline awareness, and an outbound queue. Those are not transport
concerns. They either duplicate `RealtimeClient` or reduce it to a protocol-shaped wrapper around a
second connection manager.

The useful part of that draft is the boundary below `RealtimeClient`: a transport represents one raw
duplex connection attempt. It knows how data crosses a platform boundary; it does not decide how a
logical realtime session behaves across attempts.

## Decision

Build one package, **`@bazariodev/transport`**, containing the platform-neutral `Transport` and
`TransportFactory` contracts and their concrete platform adapters: `WebSocketAdapter`,
`HttpAdapter`, and `WebTransportAdapter`. Each implementation lives in its own JavaScript file.

The package has one public entry point, plain JavaScript implementations, and separate public
`.d.ts` declarations. It contains no connection manager, FSM, timers, or application queue.
Consumer-interface checks and public behavioral tests validate the boundary.
The three adapter classes are the only runtime exports; consumers construct them with `new`.
`TransportFactory` describes the caller's factory, not another exported constructor wrapper.

`@bazariodev/realtime` depends only on the `Transport` interface from this package. The application
chooses and constructs the adapter; sharing a package does not make realtime select an adapter:

```text
application composition root
  ├─ constructs WebSocketAdapter from @bazariodev/transport
  └─ injects TransportFactory into RealtimeClient

RealtimeClient → Transport port ← WebSocketAdapter → browser WebSocket
```

This is dependency inversion without duplicated lifecycle ownership. A transport instance lives for
one attempt. `RealtimeClient` creates a fresh instance for every initial connection or reconnect.

## Responsibility boundary

| Concern | Owner | Explicitly not owned by |
| --- | --- | --- |
| one attempt's open/message/error/close mapping | concrete transport adapter | `RealtimeClient` |
| platform options and API quirks | concrete transport adapter | `transport` port, `RealtimeClient` |
| local write admission/backpressure signal | concrete transport adapter | RPC or domain packages |
| connection intent and observable lifecycle | `RealtimeClient` | transport |
| connect timeout and reconnect backoff | `RealtimeClient` | transport, `net-monitor` |
| connect/ready and ping/pong protocol | `RealtimeClient` | transport |
| authentication packet and protocol validation | `RealtimeClient` | transport |
| online/visibility/sleep detection | `net-monitor` | transport, `RealtimeClient` |
| correlation, acknowledgement, timeout, safe retry | `rpc` | transport, `RealtimeClient` |
| durable outbox, deduplication, state resync | domain package | transport, `RealtimeClient`, `rpc` |

The ownership rule is simple: **transport owns one physical attempt; realtime owns the logical
connection across attempts.**

## Transport contract

```ts
type TransportMessage = string | Uint8Array;

type TransportClose = Readonly<{
  code?: number;
  reason?: string;
  clean: boolean;
}>;

type TransportHandlers = Readonly<{
  onOpen: () => void;
  onMessage: (message: TransportMessage) => void;
  onError: (cause: unknown) => void;
  onClose: (close: TransportClose) => void;
}>;

interface Transport {
  start(handlers: TransportHandlers): void;
  send(message: TransportMessage): void;
  close(): void;
  [Symbol.dispose](): void;
}

type TransportFactory = () => Transport;
```

The contract intentionally has no `connect()`, `reconnect()`, `disconnect()`, `ready`, retry policy,
liveness policy, or message subscriptions. Traffic resets and liveness effects belong to the owner
that spans attempts; timer mechanics and ping/pong state compose behind it.

### Adapter obligations

- `start()` is called at most once. It installs handlers before opening platform resources.
- A synchronous `start()` failure is terminal and silent. It rethrows the original error; a later
  `close()` emits no event and a later `start()` throws.
- Handlers must not throw; an exception from a handler has adapter-specific effects.
- `onOpen` fires at most once.
- `onMessage` preserves the ordering supplied by the underlying transport.
- `onError` is diagnostic. It does not itself mean that the attempt is terminal.
- `onClose` is the sole terminal event and fires exactly once for a successfully started attempt,
  including a locally requested close, unless disposal suppresses it first.
- `onClose` is never delivered synchronously from a caller's `close()`. Disposal suppresses pending
  notifications as well as future platform events.
- No handler fires after `onClose` or disposal.
- `send()` returns normally with no value only when the adapter accepts the write into the current
  attempt's bounded buffer. It throws when the attempt is not open or its local write limit would be exceeded, and
  propagates synchronous platform write errors unchanged. It never queues data for a later attempt.
- Synchronous write failures are thrown to the caller, not emitted through `onError`. A successful
  return confirms local write acceptance, not remote delivery.
- HTTP requests and WebTransport writes complete asynchronously. A later failure reports `onError`
  followed by an unclean `onClose`; it cannot be thrown from an already-returned `send()`.
- `close()` and disposal are idempotent and may be called while opening or open.
- `close()` before `start()` is terminal and silent: a later `start()` throws.
- An adapter does not parse application packets, authenticate, send heartbeats, reconnect, or observe
  browser network state.

`RealtimeClient` still guards callbacks with its own attempt generation. The port contract prevents
bad adapter behavior; the generation guard prevents an unavoidable late platform callback from
corrupting a newer logical attempt.

## WebSocket adapter

`@bazariodev/transport` exports `WebSocketAdapter`. Its options are
wire-specific and therefore do not leak into `RealtimeClient`:

```ts
type WebSocketAdapterOptions = Readonly<{
  url: string | (() => string);
  logger?: Logger;
  protocols?: string | ReadonlyArray<string>;
  maxBufferedBytes?: number; // default 1 MiB
  WebSocket?: new (
    url: string,
    protocols?: string | string[],
  ) => WebSocket;
}>;
```

For each `start()` it resolves the URL, creates one WebSocket, sets `binaryType = 'arraybuffer'`, and
maps platform events to `TransportHandlers`. Text stays `string`; `ArrayBuffer` becomes
`Uint8Array`. An unexpected data kind is reported and the attempt is closed.

`send()` checks `WebSocket.OPEN` and the projected `bufferedAmount` before calling the platform API.
It throws a plain error when not open or when the buffer limit would be exceeded. A platform write
exception propagates unchanged. There is no adapter queue beyond the browser-owned WebSocket buffer.
Close metadata is native: a locally canceled connection can still report `clean: false` if its
closing handshake did not complete, including cancellation while connecting.

The adapter detaches platform callbacks when terminal or disposed. Production deployments use
`wss://`; browser WebSockets do not support arbitrary request headers, but that limitation remains an
adapter/deployment concern. Realtime authentication uses its protocol-level connect packet.

## HTTP and WebTransport wire contract

Both stream adapters use the same message frame: one type byte (`0` for UTF-8 text, `1` for binary),
four bytes of unsigned big-endian payload length, then the payload. A stream can split or combine
frames arbitrarily. Empty messages are valid. Unknown types, invalid UTF-8, oversized messages, and
an incomplete frame at EOF fail the attempt. `maxMessageBytes` bounds each payload (default 1 MiB);
`maxBufferedBytes` bounds outstanding outgoing frames including their headers (default 1 MiB).
This is transport framing, independent of application packets. Servers must implement this format.

`HttpAdapter` opens a streaming GET and sends one frame per POST to the same URL. The application
provides an attempt-specific URL; the server associates its GET and POST requests with that attempt.
The GET returns a successful response with an `application/octet-stream` body and flushes headers
immediately, allowing the client to send its first message. POSTs run sequentially to preserve order;
the server responds successfully after accepting each message. A bounded, attempt-local write buffer
holds accepted POSTs until the preceding request completes. There is no retry or cross-attempt replay.
Headers and credentials are configurable. Local close/disposal aborts requests and drops pending writes.
EOF closes the attempt; GET/POST failures report an error and close it uncleanly.

`WebTransportAdapter` waits for the session and creates one reliable bidirectional stream. It opens
only once that stream is available, and uses its native ordered writer. Session closure, stream EOF,
and read/write failures end the attempt. Local close/disposal cancels the reader, aborts the writer,
and closes the session. It does not use datagrams or additional streams.
Session-sourced stream errors defer to the existing `session.closed` listener so its close metadata
or connection failure determines the result. A stream-specific failure or EOF still ends the attempt
immediately, before any later session metadata. No timeout race waits for optional metadata.

Adapters open lazily in `start()` and accept platform injection under `WebSocket`, `fetch`, or
`WebTransport`. Native WebTransport settings use `sessionOptions`. They have no connection timer;
realtime owns connection deadlines. HTTP and WebTransport local close release resources immediately
and defer their clean close notification to a microtask; disposal is silent and cancels that notification.

## Logging

All three adapters accept an optional `logger` with the repository's existing
`debug(message, meta?)`, `warn(message, meta?)`, and `error(message, meta?)` interface.
The default is a no-op logger; the package has no logging dependency or direct console calls.
`debug` records starting, opening, and delivered close notifications, including close metadata.
`error` records synchronous start failures and connection diagnostics with their original cause.
Messages identify the adapter. There are no per-message logs; URLs, headers, and payloads are not
added to log metadata. Synchronous send rejection remains the caller's responsibility.
Disposal suppresses pending and future callback logs along with the callbacks themselves.
Logger methods must not throw. The interface includes `warn` for compatibility with existing
package loggers, though adapters currently use only `debug` and `error`.

## Composition

```ts
import { WebSocketAdapter } from '@bazariodev/transport';

const client = new RealtimeClient({
  createTransport: () =>
    new WebSocketAdapter({
      url: () => realtimeUrl,
      protocols: 'bazario.realtime.v1',
    }),
  auth: () => authSession.realtimeCredentials,
});
```

The application imports `realtime` and selects an adapter from `transport`. `realtime` consumes only
the shared contract. Replacing the adapter does not change `RealtimeClient`.

## Scope

In v1:

- one minimal transport contract for ordered text/binary messages;
- WebSocket, streaming HTTP, and reliable-stream WebTransport adapters;
- local write admission through `send()`, throwing on rejection;
- deterministic constructor injection for adapter tests;
- one `transport` package with zero runtime dependencies and a shared contract.

Not in v1:

- connection FSM, reconnect, backoff, heartbeat, readiness, or network monitoring;
- cross-attempt or application message queues;
- JSON or domain packet parsing;
- authentication, RPC, acknowledgements, retries, persistence, or recovery;
- polling, datagrams, transport selection, or live upgrades.

## Validation and testing

Contract tests run against every adapter:

- one ordered `open → message* → close` sequence;
- construction/start failure becomes one terminal close or a caught `start()` exception;
- local close while opening and while open is idempotent;
- local close cannot synchronously re-enter the caller, and disposal cancels pending close delivery;
- close before start permanently prevents starting without emitting a close event;
- no callback after terminal close or disposal;
- `send()` throws before open, during/after close or disposal, and above the adapter's write limit;
- a successful write returns no value;
- a synchronous platform `send()` failure propagates the original error without retaining the message;
- text and binary normalization preserve data and order.

WebSocket-specific tests add URL/protocol construction, `binaryType`, platform event mapping,
`bufferedAmount`, clean/unclean close metadata, and stale platform callbacks after teardown.

HTTP and WebTransport tests cover wire bytes, split/coalesced frames, ordered writes, bounded
buffering, async errors, EOF, and cancellation during connection and writes. HTTP additionally
exchanges messages with a real local streaming server. WebTransport tests use native Web Streams
behind an injected session. A real Chrome 152 / aioquic 1.3.0 HTTP/3 check reproduced and verified the
session-close metadata fix, independent of those unit tests. See the
[native verification report](../../../packages/transport/WEBTRANSPORT_CHECK.md).

`RealtimeClient` tests use a stub `Transport`; they do not mock the browser WebSocket. This keeps
logical lifecycle tests independent from adapter mechanics.

## Alternatives considered

**Use browser WebSocket directly inside `RealtimeClient`.** Rejected. A constructor factory is enough
for tests but does not establish the reusable port-and-adapter boundary selected by the repository.

**Keep the earlier `ManagedConnection`.** Rejected. It duplicates realtime ownership by putting FSM,
reconnect, heartbeat, offline, and queue policy below `RealtimeClient`.

**Separate npm packages for the contract and each adapter.** Rejected. A shared package keeps
installation, declarations, tests, and releases together. Separate implementation files and an
injected `TransportFactory` preserve the same responsibility boundary.

**Replay writes across attempts in the transport layer.** Rejected. A raw transport cannot decide
whether a message is safe, current, idempotent, or durable enough to replay. Bounded buffering within
an open attempt is allowed: HTTP serializes POSTs and the other adapters use native write buffers.

## Consequences

Positive:

- `RealtimeClient` is transport-independent without surrendering lifecycle ownership;
- adapter mechanics and protocol mechanics are independently testable;
- WebSocket-specific options do not leak upward;
- all three adapters share lifecycle semantics while keeping their platform code separate.

Tradeoffs:

- transport adapters share one package version and release;
- the application composition root must select an adapter explicitly;
- the first port may need evidence-driven revision when a genuinely different transport is added.

## Next steps

Implemented: `packages/transport/`, containing the shared contract, all three adapters, public
declarations, consumer-interface checks, and behavioral tests. The initial `0.1.0` release is staged
through Changesets.

1. Implement `IdleWatchdog.md` and `Keepalive.md` before composing attempt-local liveness.
2. Inject `TransportFactory` into `RealtimeClient` and prove reconnect with a stub transport.
3. Validate the HTTP framing and WebTransport stream contract against the deployment's server.

## Summary

`@bazariodev/transport` contains one physical-attempt contract and its platform adapters, starting
with WebSocket, HTTP, and WebTransport. It does not own logical connection behavior. `RealtimeClient` composes over the
port and remains the single owner of readiness, handshake, traffic-reset policy, liveness effects,
reconnect, and state across attempts. `IdleWatchdog` and `Keepalive` supply only timer and ping/pong
mechanics. See the [realtime client hierarchy](../../../docs/realtime-client-hierarchy.html) for the
complete dependency graph and concern matrix.
