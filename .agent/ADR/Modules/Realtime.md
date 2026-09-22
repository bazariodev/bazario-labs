# ADR: Lightweight Realtime Client

- Status: Proposed
- Date: 2026-09-03
- Revised: 2026-09-22

## Context

R2 needs a browser session that reconnects through network changes and laptop sleep, exposes honest
connection state, and carries messages for the later `rpc`, presence, and chat packages. The first
implementation must be small enough to understand as one unit and useful without Socket.IO.

Socket.IO solves a much wider problem. Its client separates physical Engine.IO transports from
logical namespace sockets, then adds transport selection and upgrades, packet parsers, namespaces,
acknowledgements, retries, buffering, and optional connection-state recovery. The separation is
useful; the complete framework is larger than Bazario needs.

Ringotel demonstrates the product requirements but also the cost of splitting logical connection
policy across an FSM configuration, effects class, notifier, reconnect scheduler, keepalive,
watchdog, factory, and application orchestrator. The problem is duplicated policy, not the existence
of small reusable primitives. A raw transport adapter, an idle timer, and a keepalive with a bounded
per-ping deadline are valid boundaries as long as none becomes a second lifecycle manager. The
reusable lessons are:

- `READY` must be the only sendable state;
- manual disconnect must suppress reconnect;
- one owner must replace stale attempts and ignore callbacks from superseded instances;
- backoff resets only after a successful ready handshake;
- wake/network recovery needs explicit immediate-probe and force-reconnect operations;
- missed messages are recovered by application synchronization, not assumed to have arrived.

## Decision

Build one package, **`@bazariodev/realtime`**, with one main class, **`RealtimeClient`**.

It owns exactly five concerns that must agree on one logical lifecycle:

1. create and retire one injected `Transport` attempt at a time;
2. perform a small JSON connect/ready handshake;
3. compose idle detection and a configurable ping/pong probe while owning every traffic reset and
   transport effect;
4. reconnect with capped exponential backoff and jitter while connection intent remains true;
5. expose state and validated JSON application messages to consumers.

The package depends on the thin `Transport` contract from `@bazariodev/transport`, uses
`@bazariodev/fsm` for its four-state lifecycle, and uses `@bazariodev/fsm-delays` for the connect
timeout and reconnect delay. It composes `@bazariodev/idle-watchdog` and
`@bazariodev/keepalive` for attempt-local liveness. `RealtimeClient` owns the current transport
instance, liveness wiring, traffic-reset policy, attempt generation, and listener registries. One
transport attempt intentionally spans both `connecting` and `ready`.

The transport contract owns no FSM, reconnect, heartbeat, readiness, offline, or cross-attempt queue.
The application composition root selects `WebSocketAdapter`, `HttpAdapter`, or
`WebTransportAdapter` from `@bazariodev/transport`; `realtime` does not import a concrete adapter. `IdleWatchdog`
owns only a re-armable inactivity timer, and `Keepalive` owns at most one ping/pong round and response
deadline at a time. Neither
receives a transport or reconnect callback.

## Architecture and ownership

```text
product/domain packages
        ↓ typed operations
@bazariodev/rpc
        ↓ send / onMessage / onReady
@bazariodev/realtime (logical connection across attempts)
        ├─ @bazariodev/idle-watchdog (attempt-local idle timer)
        ├─ @bazariodev/keepalive (attempt-local ping/pong state + deadline)
        ↓ TransportFactory
@bazariodev/transport: Transport (one-attempt port)
        ↑ implemented by
WebSocketAdapter (same package) → browser WebSocket → realtime server
```

The application imports `realtime` and its chosen adapter. Package dependencies point inward:

- `transport` contains the contract and platform adapters, with no runtime dependencies;
- `idle-watchdog` and `keepalive` have no runtime dependencies and no transport knowledge;
- `realtime` depends on the interface from `transport`, plus `fsm`, `fsm-delays`, `idle-watchdog`, and
  `keepalive`; the application selects the concrete transport adapter;
- `rpc` depends only on the public realtime message/readiness seam;
- product/domain packages compose over `rpc` or the smallest realtime seam they require.

Cross-cutting modules do not sit in the message path. `auth-session` supplies fresh credentials for
the next realtime attempt. `net-monitor` detects network/visibility/wake changes, requests
`probeNow()` for a questionable ready connection, and requests `reconnect()` when the transport must
be replaced. `fsm-react` and `fsm-inspect` observe the structural realtime snapshot. None of them may
open, close, retain, or replace the current transport.

The ownership rule is: **transport owns one physical attempt; watchdog owns inactivity timer
mechanics; keepalive owns ping/pong protocol state and its per-ping response deadline; realtime owns
the logical connection, traffic resets, and all transport effects across attempts; higher layers own
application delivery semantics.** See
`Transport.md`, `IdleWatchdog.md`, and `Keepalive.md` for the narrower contracts.

## Socket.IO ideas: take and leave

| Socket.IO idea | Bazario v1 |
| --- | --- |
| separate physical transport from logical client | take: a minimal one-attempt `Transport` port |
| transport open is not application ready | take: wait for a server `ready` packet |
| explicit active/manual-disconnect distinction | take: private desired-connected intent |
| one reconnect loop with capped jittered backoff | take |
| ping/pong liveness | take the correlated exchange and bounded response deadline; trigger the first round only after socket idleness or an explicit probe |
| connection-attempt timeout | take |
| cleanup subscriptions and ignore stale engines | take: one monotonic attempt generation |
| typed event maps and unsubscribe handles | take, with a smaller API |
| ephemeral connection id | expose for diagnostics only, never application identity |
| namespaces and connection multiplexing | leave |
| polling/WebTransport fallback and live upgrades | leave; adapter selection is static in v1 |
| custom packet parsers and binary attachments | leave; v1 is bounded JSON |
| automatic send buffer and retry queue | leave; replay semantics belong to `rpc`/outbox owners |
| acknowledgements and request correlation | leave to `@bazariodev/rpc` |
| missed-event persistence and recovery offsets | leave to server/domain synchronization |

## Wire protocol v1

Every realtime protocol message is one UTF-8 JSON object carried as a transport text message.
`protocol: 1` is explicit so an incompatible peer fails once rather than reconnecting forever with a
format it cannot understand. Binary transport messages are outside protocol v1 and fail closed.

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

type ClientPacket =
  | Readonly<{ type: 'connect'; protocol: 1; auth?: JsonValue }>
  | Readonly<{ type: 'ping'; id: string }>
  | Readonly<{ type: 'pong'; id: string }>
  | Readonly<{ type: 'message'; data: JsonValue }>;

type ServerPacket =
  | Readonly<{
      type: 'ready';
      protocol: 1;
      connectionId: string;
    }>
  | Readonly<{ type: 'ping'; id: string }>
  | Readonly<{ type: 'pong'; id: string }>
  | Readonly<{ type: 'message'; data: JsonValue }>
  | Readonly<{
      type: 'connect_error';
      code: string;
      message?: string;
      retryable: boolean;
    }>;
```

Handshake:

1. the injected transport opens;
2. the client sends one `connect` packet, resolving `auth` fresh for this attempt;
3. the server sends `ready` or `connect_error`;
4. only `ready` moves the client to the sendable `ready` state.

After `ready`, `RealtimeClient` creates an attempt-local `IdleWatchdog` and `Keepalive`, wires the
watchdog's `onIdle` event to `keepalive.handleIdle()`, and calls `watchdog.reset()`. Every valid
incoming packet and every outgoing packet accepted by the transport resets the watchdog. Keepalive
and the watchdog never reset it themselves.

The first idle event asks `RealtimeClient` to send a client `ping`. Keepalive arms its configurable
`deadlineMs` before publishing that send request. A successful write resets the watchdog, but that
traffic reset does not move the pending ping deadline. A server `pong` with the same id completes the
probe and clears the deadline. If no matching pong arrives in time, keepalive clears the expired
round and emits `timeout` with its correlation.

Generic keepalive would start a fresh correlated round after timeout notification unless stopped.
`RealtimeClient` deliberately stops it synchronously in its timeout subscriber, reports a
`keepalive` error, and retires the current transport generation. This prevents the next round from
sending on an attempt that realtime policy has already declared failed.

`RealtimeClient.probeNow()` delegates synchronously to the current keepalive while `ready`. This
sends a ping immediately instead of waiting for the first idle window; the same configured
`deadlineMs` bounds its answer. If a probe is already pending, the call is idempotent and preserves
its correlation rather than invalidating a pong already in flight. The method is inert when
keepalive is disabled or the client is not ready.

The protocol is symmetric enough to accept a server `ping`: keepalive asks `RealtimeClient` to send
the matching client `pong`. Active application or control traffic postpones the next idle-triggered
probe because the selected policy measures total socket idleness; it does not postpone an existing
ping's deadline. Only a matching pong completes an outstanding probe. Ping/pong remains part of the
realtime protocol, not the raw transport contract.

Browser timers can be delayed in background tabs. Keepalive is therefore a quiet-socket fallback,
not the only wake mechanism: `net-monitor` requests `probeNow()` after a visibility or sleep/wake
change rather than waiting for the idle window. A confirmed network-generation change can still
request immediate `reconnect()`.

`auth` is opaque JSON resolved on every attempt. The realtime package includes it in the connect
packet but does not store, refresh, or log credentials. Transport URL, subprotocol, TLS, and platform
header limitations belong to the selected adapter and deployment.

## Public API

Illustrative types; exact helper names may change without changing this decision.

```ts
type RealtimeState = 'idle' | 'connecting' | 'ready' | 'backoff';

type RealtimeContext = Readonly<{
  attempt: number; // 0 initially; 1 for the first retry
  connectionId: string | null;
}>;

type RealtimeSnapshot = FsmSnapshot<RealtimeState, RealtimeContext>;

type ReconnectOptions = Readonly<{
  initialDelayMs?: number; // default 500
  maxDelayMs?: number;     // default 30_000
  factor?: number;         // default 2
}>;

type RealtimeKeepaliveOptions = Readonly<{
  idleMs?: number;     // default 30_000; quiet time before the first probe
  deadlineMs?: number; // default 30_000; maximum time for each matching pong
}>;

type RealtimeClientError = Readonly<{
  kind: 'connection' | 'protocol' | 'keepalive' | 'send';
  message: string;
  cause?: unknown;
}>;

type RealtimeClientOptions = Readonly<{
  createTransport: TransportFactory;
  auth?: () => JsonValue | undefined;
  reconnect?: ReconnectOptions;
  keepalive?: RealtimeKeepaliveOptions | false;
  connectTimeoutMs?: number; // default 10_000; includes the ready handshake
  maxMessageBytes?: number;  // default 1 MiB
  scheduler?: Scheduler;
  random?: () => number;
  logger?: Logger;
}>;

class RealtimeClient {
  constructor(options: RealtimeClientOptions);

  readonly snapshot: RealtimeSnapshot;
  readonly state: RealtimeState;

  connect(): void;
  reconnect(): void;
  disconnect(): void;
  probeNow(): void;
  send(data: JsonValue): boolean;

  subscribe(listener: (snapshot: RealtimeSnapshot) => void): Unsubscribe;
  onReady(listener: (info: Readonly<{ connectionId: string; reconnect: boolean }>) => void): Unsubscribe;
  onMessage(listener: (data: JsonValue) => void): Unsubscribe;
  onError(listener: (error: RealtimeClientError) => void): Unsubscribe;

  stop(): void;
  [Symbol.dispose](): void;
}
```

`createTransport()` is called once for each attempt and must return a fresh, unstarted `Transport`.
Construction or `start()` failures are ordinary attempt failures handled by the realtime backoff
policy. Unless explicitly disabled, realtime constructs fresh watchdog and keepalive instances after
each ready handshake. Their generic packet adapter is fixed to the realtime v1 `ping`/`pong` shapes;
other consumers configure the generic `@bazariodev/keepalive` package directly.

Listener registration returns its cleanup function; paired `onX`/`offX` methods and a separate
notifier object add no value. State observation satisfies the existing `FsmSubscribable` shape, so
`fsm-react` and `fsm-inspect` work without realtime-specific bindings.

## Lifecycle and invariants

```text
idle --connect--> connecting --ready packet--> ready
                         |                       |
                         +--failure/timeout------+--> backoff --delay--> connecting

any state --disconnect--> idle
any active state --reconnect--> connecting (replace immediately, no delay)
```

- `connect()` is idempotent, sets desired-connected intent, and never opens a second concurrent
  transport attempt.
- `disconnect()` is restartable: it clears intent and backoff, retires the transport gracefully,
  clears the connection id, and returns to `idle`.
- `reconnect()` is the explicit replacement/network-recovery seam. It keeps intent true, cancels any
  delay, retires the current generation, and starts a new attempt immediately.
- `probeNow()` is the non-destructive wake/foreground seam. It is a guarded delegation to the current
  keepalive only while ready; it never changes connection intent or replaces an attempt by itself.
- An unexpected transport factory/start/open/close, handshake, or keepalive failure enters `backoff`
  only while intent is true. A non-retryable `connect_error` clears intent and returns to `idle`.
- Backoff is `random() * min(maxDelayMs, initialDelayMs * factor^(attempt - 1))`. Only a valid `ready`
  packet resets the attempt counter. Reconnect continues until explicit disconnect, stop, or a
  non-retryable server verdict; v1 has no arbitrary max-attempt flag that can strand a session.
- A monotonic generation guards every transport callback. Retiring an attempt increments the
  generation before closing and disposing its transport; late callbacks are ignored.
- Transport `onError` is diagnostic and does not independently schedule reconnect. Terminal
  `onClose`, connect timeout, handshake failure, keepalive timeout/error, or rejected keepalive write
  retires the attempt and schedules at most one reconnect. The timeout handler stops keepalive before
  it can continue with a fresh round.
- Incoming packets are size-checked, parsed, and validated before any application listener runs.
  A malformed, oversized, binary, pre-ready application, or unsupported-version packet is a protocol
  error: retire the transport, stop automatic retry, return to `idle`, and notify `onError`.
- Listener exceptions are caught and logged independently. They never become protocol/transport
  failures and never stop delivery to later listeners.
- Attempt retirement disposes keepalive and the watchdog before closing the transport. Their late
  events cannot act on a newer generation.
- `stop()` is terminal and idempotent: clear intent, transport, timers, attempt-local liveness,
  FSM-delays runner, and listeners. Methods are inert afterward and `send()` returns `false`.

## Send and delivery semantics

`send()` succeeds only in `ready`. It JSON-encodes one `message` packet, rejects a packet above
`maxMessageBytes`, and hands the text to the current transport. `transport.send()` returns no value
on acceptance and throws on rejection. The client resets the attempt-local watchdog only after that
call returns successfully, then returns `true` from its own public `send()` method. It catches
transport write exceptions and reports them as the cause of a `send` error. Its public method returns
`false` when not ready, serialization fails, the packet is oversized, or the transport rejects the
write; rejected writes never extend the idle deadline. Internal handshake and keepalive writes use
the same exception handling; failed control writes retire the attempt according to lifecycle policy.

The client has **no application outbound queue**. It cannot know whether a request is idempotent,
whether a presence update is obsolete, or whether a chat message belongs in a durable outbox. It also
cannot know whether a frame handed to the browser immediately before disconnect reached the server.
Blind replay would therefore create stale bursts and possible duplicates while still not offering a
delivery guarantee.

v1 guarantees only the in-attempt ordering required by the transport contract. Arrival is
at-most-once. The future `rpc` package may add correlation, timeouts, acknowledgements, and explicitly
safe retries; chat may add durable ids/outbox behavior. On every `onReady`, consumers that depend on
server state must run their own snapshot/delta synchronization because events missed while
disconnected are not silently reconstructed.

## Scope

In v1:

- transport-neutral bounded JSON packets, connect/ready/error and ping/pong control packets;
- four-state FSM, connect timeout, automatic reconnect, capped jitter, force reconnect;
- attempt-local idle watchdog and protocol-configured correlated keepalive with a separate response
  deadline;
- immediate ready-state liveness probing without waiting for the idle scheduler;
- stale-generation protection, sendability guard, deterministic injected transport/time/random;
- observable snapshots plus ready/message/error subscriptions;
- zero third-party runtime dependencies beyond the Bazario transport/FSM/watchdog/keepalive packages.

Not in v1:

- namespaces, rooms, multiplexing, binary attachments, custom parsers;
- concrete transports, transport selection, live upgrades, or adapter-specific options;
- application message buffering, acknowledgement, retries, deduplication, persistence, or recovery;
- auth refresh/session ownership, browser online/visibility/sleep detection, RPC, presence, or chat.

`auth-session` owns credentials. `net-monitor` detects online/visibility/wake and calls the public
`probeNow()` or `reconnect()` seam; it does not mutate internal timers. `rpc` owns request/response
semantics. Domain packages own resynchronization and durable delivery.

## Validation and testing

Construction validates finite positive limits, `keepalive.idleMs`, `keepalive.deadlineMs`, reconnect
bounds, and callable injections. Concrete adapter construction and security are validated by that
adapter. Every packet shape is validated at the realtime protocol boundary. Errors expose safe
categories and causes to callers; packets, auth, adapter options, and payloads are never logged.

Required public-behavior tests:

- `idle -> connecting -> ready`, handshake packet, and ready-gated send/message delivery;
- duplicate `connect()` opens once; manual `disconnect()` never reconnects; reconnect revives it;
- transport factory/start/close, connect-timeout, and keepalive-timeout paths schedule exactly one
  retry; diagnostic transport errors alone do not start another retry path;
- deterministic capped jitter and reset only after ready;
- stale open/message/error/close callbacks from a retired transport do nothing;
- ready entry and every valid incoming/accepted outgoing packet reset only the current watchdog;
- first idle requests one correlated ping; accepted ping resets the watchdog without moving the
  response deadline; matching pong is consumed and clears that deadline;
- response-deadline expiry reports the timed-out correlation, then realtime stops keepalive before
  its automatic next round and reconnects exactly once;
- ready `probeNow()` requests a ping immediately, repeated calls preserve a pending probe, and calls
  outside ready or with keepalive disabled are inert;
- back-to-back or re-entrant ready probes coalesce into one keepalive ping without a client-side
  queue;
- peer ping receives a matching pong through the generation-guarded internal send path;
- rejected keepalive writes fail the current attempt without resetting its watchdog;
- post-sleep recovery probes immediately through `net-monitor`; the configured response deadline or
  confirmed network replacement then follows the ordinary reconnect path;
- retryable versus non-retryable `connect_error`;
- malformed, oversized, binary, unsupported-version, and pre-ready packets fail closed;
- no application send queue; a transport write exception is caught and reported, and the client's
  public `send()` returns false without resetting the watchdog;
- listener failure isolation and idempotent terminal `stop()`;
- snapshot reference stability between FSM commits.

Transport package tests prove the public contract, all three adapter mappings, framing, and write admission.
Future adapters in that package must satisfy the same behavioral contract. The R2 demo adds the
integration proof: compose
`WebSocketAdapter`, authenticate, receive messages, unplug/replug network, suspend and wake a
laptop, issue an immediate wake probe, reconnect on its timeout or confirmed network replacement,
resynchronize missed state, and show the four connection states honestly.

## Alternatives considered

**Use Socket.IO.** Rejected for v1. It is mature, but its protocol, fallback transports, namespaces,
buffers, acknowledgements, recovery, and dependency graph are more product than Bazario currently
needs. Its design remains reference material and it can still be used behind a future signaling or
application adapter if a deployment already standardizes on it.

**Use browser WebSocket directly.** Rejected. A constructor seam is enough for tests but does not
preserve the repository's selected port-and-adapter direction or keep platform options below the
logical client.

**Put lifecycle policy in `transport` through `ManagedConnection`.** Rejected. Reconnect, heartbeat,
readiness, offline policy, and a cross-attempt queue would make transport a second realtime client and
create ambiguous ownership. The accepted transport boundary is one physical attempt only.

**Reuse Ringotel's class graph.** Rejected as a package blueprint. Its behavior is valuable evidence,
but its transport/effects/notifier/backoff/keepalive/watchdog/factory split and eight states reflect an
existing application's history and orchestration. Bazario keeps only two bounded primitives:
`IdleWatchdog` owns one inactivity timer and `Keepalive` owns one response-deadline timer and one
protocol round at a time. `RealtimeClient` still owns the four-state lifecycle, wiring, reset policy,
and every transport effect.

**Fixed client-initiated ping interval.** Rejected. It sends redundant traffic on an already-active
connection and synchronized clients can remain in lockstep. A one-shot watchdog moves the probe out
after every accepted traffic item. Server-initiated pings are still answered through the configured
keepalive adapter.

**Let keepalive or the watchdog close the transport.** Rejected. They cannot prove that a callback
still belongs to the current attempt. Only `RealtimeClient` owns generation-guarded retirement and
backoff.

**Copy Ringotel's full verification cadence into keepalive v1.** Deferred. Its `probeNow()`
invariant—do not replace an outstanding correlation—and a distinct response deadline are retained.
Its random idle window, configurable unanswered-ping budget, direct transport access, and close
callback are not required for the first reusable contract and would duplicate inactivity or
lifecycle policy.

**Buffer sends while disconnected.** Rejected. A generic client cannot safely choose replay,
idempotency, expiry, or persistence policy for application messages.

## Consequences

Positive:

- one logical lifecycle owner can be read, tested, and debugged end to end;
- one-attempt transport adapters stay replaceable and independently testable;
- the client is honest about readiness, liveness, delivery, and missed-event recovery;
- the fixed control protocol gives the demo server a small interoperable contract;
- the first domain use exercises the transport/FSM/delays/watchdog/keepalive packages through their
  public seams;
- future `rpc`, auth, net-monitor, and domain packages compose over narrow public seams.

Tradeoffs:

- each adapter requires a compatible server endpoint, and realtime v1 uses Bazario's JSON control protocol;
- applications must handle failed sends and resynchronize after every reconnect;
- a completely quiet dead connection is detected after approximately `idleMs + deadlineMs`, and
  browser scheduling can delay that verdict;
- a wake-triggered `probeNow()` skips the idle window but still allows one configured `deadlineMs`
  for the answer;
- binary/high-throughput workloads need a later protocol or transport;
- the application composition root must choose an adapter explicitly;
- HTTP and WebTransport servers must implement the stream framing defined in `Transport.md`.

## Next steps

1. Accept this ADR with `Transport.md`, `IdleWatchdog.md`, and `Keepalive.md`.
2. Use the implemented `transport` package (contract and all three adapters), then implement idle
   watchdog and keepalive packages with their contract tests.
3. Scaffold `packages/realtime/` with protocol types/validators, the four-state client, stub-transport
   tests, and attempt-local liveness composition.
4. Implement from the public-behavior tests above, then add changesets at `0.1.0`.
5. Add the matching protocol endpoint to `examples/server` and prove network/sleep recovery.
6. Design `@bazariodev/rpc` over only `send`, `onMessage`, and `onReady`; do not reach into transport.
7. Extract `fsm-retry` only after the inline backoff has been proven here.

## References

- Socket.IO protocol v5: <https://github.com/socketio/socket.io/blob/main/docs/socket.io-protocol/v5-current.md>
- Socket.IO client manager: <https://github.com/socketio/socket.io/blob/main/packages/socket.io-client/lib/manager.ts>
- Socket.IO namespace socket: <https://github.com/socketio/socket.io/blob/main/packages/socket.io-client/lib/socket.ts>
- Engine.IO client socket: <https://github.com/socketio/socket.io/blob/main/packages/engine.io-client/lib/socket.ts>
- Engine.IO protocol v4: <https://github.com/socketio/engine.io-protocol>
- Socket.IO delivery guarantees: <https://socket.io/docs/v4/delivery-guarantees>
- Bazario transport boundary: `Transport.md`
- Bazario idle timer boundary: `IdleWatchdog.md`
- Bazario ping/pong boundary: `Keepalive.md`
- Bazario hierarchy and responsibility guide:
  [realtime client hierarchy](../../../docs/realtime-client-hierarchy.html)
- Ringotel reference: `/Users/alexus/Projects/Ringotel/web-app/src/shared/lib/realtime` and
  `/Users/alexus/Projects/Ringotel/web-app/src/shared/lib/reconnect`

## Summary

`@bazariodev/realtime` is one small logical JSON client with four states: `idle`, `connecting`,
`ready`, and `backoff`. It composes over the one-attempt `@bazariodev/transport` port and borrows
Socket.IO's handshake, intent, cleanup, and reconnect discipline. Attempt-local `IdleWatchdog` and
`Keepalive` primitives provide an idle-triggered correlated probe with a distinct response deadline,
without receiving the transport. The same keepalive can be probed immediately after wake or
foreground return without involving the watchdog scheduler.
Concrete platform mechanics remain below and queues, acknowledgements, retries, and recovery remain
above. `RealtimeClient` is the sole logical connection-lifecycle, traffic-reset, and transport-effect
owner; `auth-session`, `net-monitor`, `rpc`, and domain synchronization compose around it instead of
being absorbed into it.
