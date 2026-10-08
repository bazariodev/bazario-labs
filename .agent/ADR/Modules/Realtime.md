# ADR: Lightweight Realtime Client

- Status: Proposed
- Date: 2026-09-03
- Revised: 2026-09-29

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
per-probe deadline are valid boundaries as long as none becomes a second lifecycle manager. The
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
3. handle ping/pong controls on every ready attempt, enable keepalive monitoring by default, report
   validated inbound traffic, and own probe binding and failure recovery;
4. reconnect with capped exponential backoff and jitter while connection intent remains true;
5. expose state and validated JSON application messages to consumers.

The package uses the thin `Transport` contract from `@bazariodev/transport` only in public types, uses
`@bazariodev/fsm` for its four-state lifecycle, and uses `@bazariodev/fsm-delays` for the connect
timeout and reconnect delay, with `@bazariodev/fsm-effects` supplying delays' required runtime peer.
It composes `@bazariodev/keepalive` for attempt-local liveness;
keepalive owns two internal `@bazariodev/idle-watchdog` instances. `RealtimeClient` owns the current
transport, traffic classification, guarded writes, attempt generation, and event publication. It
composes a private `Emitter` from `@bazariodev/coordination` for ready/message/error listeners.
One transport attempt intentionally spans both `connecting` and `ready`.

The transport contract owns no FSM, reconnect, heartbeat, readiness, offline, or cross-attempt queue.
The application composition root selects `WebSocketAdapter`, `HttpAdapter`, or
`WebTransportAdapter` from `@bazariodev/transport`; `realtime` does not import a concrete adapter. `IdleWatchdog`
owns reusable timer mechanics. `Keepalive` owns inactivity monitoring, at most one promise probe,
and a separate deadline. It receives an injected `probe(signal): Promise<void>`, never a transport
instance or reconnect callback. A small internal realtime protocol handler owns the default ping/pong
exchange and exposes `probe(signal)`. An optional custom probe can replace the client-initiated check.

## Architecture and ownership

```text
product/domain packages
        ↓ typed operations
@bazariodev/rpc
        ↓ send / onMessage / onReady
@bazariodev/realtime (logical connection across attempts)
        ├─ private coordination Emitter (ready/message/error subscriptions)
        ├─ internal protocol handler (ping/pong controls; always present while ready)
        ├─ @bazariodev/keepalive (attempt-local liveness monitor; enabled by default)
        │       └─ @bazariodev/idle-watchdog (idle and response windows)
        ↓ TransportFactory
@bazariodev/transport: Transport (one-attempt port)
        ↑ implemented by
WebSocketAdapter (same package) → browser WebSocket → realtime server
```

The application imports `realtime` and its chosen adapter. Package dependencies point inward:

- `transport` contains the contract and platform adapters, with no runtime dependencies;
- `idle-watchdog` has no runtime dependencies; `keepalive` depends only on `idle-watchdog`;
- `coordination` supplies independent primitives and has no runtime package dependencies;
- `realtime` has five direct runtime dependencies: `fsm`, `fsm-effects`, `fsm-delays`, `keepalive`,
  and `coordination` (only its Emitter export). Declare all five in `dependencies`, using
  `workspace:^` for workspace development. `fsm-effects` is declared alongside `fsm` to supply
  the required peers imported by `fsm-delays`;
- `transport` is a type-only peer dependency of `realtime`, also listed in `devDependencies` for
  local builds and declaration checks. Its public types must resolve for downstream TypeScript
  consumers; a devDependency alone does not provide that contract. The application selects and
  imports the concrete adapter. `idle-watchdog` is transitive through `keepalive`;
- `rpc` depends only on the public realtime message/readiness seam; the application can inject
  a probe backed by its request handler without adding a realtime-to-RPC package dependency;
- product/domain packages compose over `rpc` or the smallest realtime seam they require.

Cross-cutting modules do not sit in the message path. `auth-session` supplies fresh credentials for
the next realtime attempt. `net-monitor` detects network/visibility/wake changes, requests
`probeNow()` for a questionable ready connection, and requests `reconnect()` when the transport must
be replaced. `fsm-react` and `fsm-inspect` observe the structural realtime snapshot. None of them may
open, close, retain, or replace the current transport.

The ownership rule is: **transport owns one physical attempt; watchdog owns inactivity timer
mechanics; keepalive owns inactivity and promise-probe orchestration; realtime owns the logical
connection, traffic classification, and all transport effects across attempts; higher layers own
application delivery semantics.** See
`Transport.md`, `IdleWatchdog.md`, and `Keepalive.md` for the narrower contracts.

## Socket.IO ideas: take and leave

| Socket.IO idea | Bazario v1 |
| --- | --- |
| separate physical transport from logical client | take: a minimal one-attempt `Transport` port |
| transport open is not application ready | take: wait for a server `ready` packet |
| explicit active/manual-disconnect distinction | take: private desired-connected intent |
| one reconnect loop with capped jittered backoff | take |
| ping/pong liveness | internal protocol handler supplies the default promise probe; keepalive bounds it after idleness or an explicit probe |
| connection-attempt timeout | take |
| cleanup subscriptions and ignore stale engines | take: one monotonic attempt generation |
| typed event maps and unsubscribe handles | take, with a smaller API |
| ephemeral connection id | expose for diagnostics only, never application identity |
| namespaces and connection multiplexing | leave |
| polling/WebTransport fallback and live upgrades | leave; adapter selection is static in v1 |
| custom packet parsers and binary attachments | leave; v1 is bounded JSON |
| automatic send buffer and retry queue | leave; replay semantics belong to `rpc`/outbox owners |
| application acknowledgements and request correlation | leave to `@bazariodev/rpc` |
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

Every valid `ready` creates an internal protocol handler bound to that attempt's guarded writer.
It consumes `ping` and `pong` control packets before application delivery and always answers a server
`ping` with a `pong` carrying the same ID. All valid pongs are consumed, including unmatched or late
ones; only the pending probe's matching ID can fulfill its promise. A server ping never fulfills a
local probe. These controls are legal only after readiness.

Client liveness monitoring is enabled by default. With `keepalive` omitted or `{}`, realtime creates
one attempt-local Keepalive, binds the handler's `probe(signal)`, subscribes to `onFail`, and calls
`start()`. `keepalive: false` disables client-initiated idle and immediate probes only. An optional
`keepalive.probe` replaces only that check. The internal handler still consumes ping/pong and answers
server pings with either configuration. The application supplies no probe on the default path.

The handler is internal to the realtime package, with no public export or new package until a second
consumer needs it. It owns fresh correlation IDs, matching, and abort cleanup. Before writing a ping,
it registers the matcher and abort listener so an immediate response cannot be lost. It fulfills only
after a valid matching pong from this connection, rejects failed writes, and uses Keepalive's signal
instead of another deadline. Settlement or abort removes pending resources; an already-aborted signal
prevents writes. Handler disposal ends pending work and prevents further writes.

Realtime invokes both default and custom probes through a current-ready-generation guard. A custom
probe owns its request/response validation, must honor abort and await the response before fulfilling,
and must not retry or replay across attempts. It may use the application message seam; realtime does
not import RPC. Keepalive observes only the returned promise, regardless of which handler supplies it.

Only validated incoming packets on the current ready connection call `keepalive.activity()`.
Outgoing application and control writes never refresh idleness: local admission cannot prove peer
reachability. A connection that sends continuously but receives nothing still gets a probe after
`idleMs`. Payload validation remains with its owner.

Keepalive owns the probe lifecycle described in [its canonical contract](Keepalive.md#lifecycle-and-timing).
Its first timeout or operation error retires only the current transport generation through realtime's
single recovery path. Aborted or stale work cannot affect a later attempt.

`RealtimeClient.probeNow()` delegates to the current Keepalive only while ready. It invokes the probe
immediately with the same deadline, skipping the remaining idle wait. Repeated calls coalesce with
the pending operation. The method is inert when liveness monitoring is disabled or the client is not
ready. Peer-ping replies are independent internal-handler work; they remain enabled with client
probing disabled or customized, and their traffic cannot extend a pending deadline.

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
import type { KeepaliveProbe } from '@bazariodev/keepalive';

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
  deadlineMs?: number; // default 30_000; maximum wait for each probe
  probe?: KeepaliveProbe; // Defaults to the internal ping/pong handler.
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
  keepalive?: RealtimeKeepaliveOptions | false; // Default on; false disables client probes only.
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
policy. After each ready handshake, realtime constructs a fresh internal protocol handler and,
unless `keepalive: false`, a fresh Keepalive. Keepalive owns its watchdogs. Realtime supplies the
handler's probe by default; other consumers use the same generic promise contract directly.

Listener registration returns its cleanup function; paired `onX`/`offX` methods and a separate
public notifier object add no value. Internally, `onReady`, `onMessage`, and `onError` delegate to
one private Emitter following the [Coordination ADR](Coordination.md). RealtimeClient is its
first planned package adopter. The client alone can emit; subscribers receive only the owner's
subscription methods. Registering the same listener for the same event shares one subscription,
and stale unsubscribe handles cannot remove a later registration.

The emitter belongs to the logical client and survives restartable disconnect/reconnect. Terminal
stop disposes it before cleanup can publish more events, suppressing remaining callbacks in every
emission in progress. Subscription changes otherwise affect the next emission. Realtime's attempt
generation checks still guard entry to event publication; the emitter owns no connection policy.
No Queue or executor is needed for this integration.

State observation retains the existing `FsmSubscribable` shape and latest-snapshot semantics, so
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
  generation before stopping its Keepalive, disposing its handler, and closing and disposing its
  transport; late callbacks are ignored.
- Transport `onError` is diagnostic and does not independently schedule reconnect. Terminal
  `onClose`, connect timeout, handshake failure, or keepalive timeout/error
  retires the attempt and schedules at most one reconnect. Keepalive is already terminal before its
  failure notification; recovery cannot race an automatic next round.
- Incoming packets are size-checked, parsed, and validated before any application listener runs.
  Malformed, oversized, binary, or unsupported-version packets, and application messages or ping/pong
  before readiness, are protocol errors: retire the transport, stop automatic retry, return to `idle`, and notify `onError`.
- Listener exceptions are caught and logged independently. They never become protocol/transport
  failures and never stop delivery to later listeners.
- Attempt retirement invalidates the generation, stops Keepalive to abort any probe, then disposes
  the internal protocol handler before closing transport. The handler belongs to this attempt only;
  late settlement cannot affect a new one. Install the handler before notifying `onReady` listeners.
- `stop()` is terminal and idempotent: clear intent, transport, timers, attempt-local liveness,
  FSM-delays runner, and listeners. Methods are inert afterward and `send()` returns `false`.

## Send and delivery semantics

`send()` succeeds only in `ready`. It JSON-encodes one `message` packet, rejects a packet above
`maxMessageBytes`, and hands the text to the current transport. `transport.send()` returns no value
on acceptance and throws on rejection. The client's public `send()` returns `true` when that write
is accepted, even if the attempt retires synchronously during the call. It catches write exceptions
and reports them as the cause of a `send` error. It returns `false` when not ready, serialization
fails, the packet is oversized, or the transport rejects the write. Neither accepted nor rejected
writes call Keepalive or extend idleness. Handshake write failures retire the attempt
through connection policy. The internal handler uses an attempt-bound control writer that returns
void on admission and throws on failure; it never sends controls through the application's `message`
envelope. Control writes do not report activity either. A probe write failure rejects its promise;
Keepalive reports it through `onFail`. A custom probe likewise converts failed admission into rejection.

A server-pong reply write failure goes directly to RealtimeClient's guarded retirement path, including
when client probing is disabled or custom. The handler never reconnects by itself. All attempt failures
share one generation-guarded recovery decision. An application send error alone does not schedule a
second recovery loop.

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

- transport-neutral bounded JSON packets and connect/ready/error/ping/pong control packets;
- four-state FSM, connect timeout, automatic reconnect, capped jitter, force reconnect;
- default attempt-local keepalive with idle/deadline watchdogs, an internal protocol handler, and an optional custom probe;
- immediate ready-state liveness probing without waiting for the idle scheduler;
- stale-generation protection, sendability guard, deterministic injected transport/time/random;
- observable snapshots plus ready/message/error subscriptions;
- direct runtime dependencies on `fsm`, `fsm-effects`, `fsm-delays`, `keepalive`, and `coordination`;
  `transport` is a type-only peer dependency, and `idle-watchdog` is transitive through `keepalive`.

Not in v1:

- namespaces, rooms, multiplexing, binary attachments, custom parsers;
- concrete transports, transport selection, live upgrades, or adapter-specific options;
- application message buffering, acknowledgement, retries, deduplication, persistence, or recovery;
- auth refresh/session ownership, browser online/visibility/sleep detection, RPC, presence, or chat.

`auth-session` owns credentials. `net-monitor` detects online/visibility/wake and calls the public
`probeNow()` or `reconnect()` seam; it does not mutate internal timers. `rpc` owns application
request/response semantics. Domain packages own resynchronization and durable delivery.

## Validation and testing

Construction validates resource limits, reconnect bounds, and effective keepalive durations before
any transport is created. For duration validation, construct a temporary, unstarted `Keepalive` with
the resolved durations and a placeholder probe, call `stop()`, and discard it. Its watchdog
constructors run the existing checks; construction and disposal without starting call neither the
scheduler nor the probe. This adds no public validation helper or duplicate numeric rules.

This temporary instance is never used for a connection. Each ready attempt still creates its own
Keepalive with the actual attempt-bound probe. With `keepalive: false`, skip the temporary instance
because there are no keepalive durations to validate.

A supplied custom `keepalive.probe` other than `undefined` must be a function: reject invalid
configuration with TypeError at construction. Omitted/undefined selects the built-in probe.
Keepalive itself retains its typed contract and reports invocation errors when a check runs.

Concrete adapter construction/security belong to that adapter. Realtime validates all protocol
packets, including ping/pong IDs; custom handlers validate their application probe payloads. Errors
expose safe categories and causes. Realtime does not log protocol packets, auth, adapter options,
or payloads. Forward the configured logger to Keepalive so listener failures retain their original
cause; the application chooses diagnostics and any redaction. Recovery must complete before calling
external error listeners, so a listener exception cannot leave a failed attempt active.

Required public-behavior tests:

- `idle -> connecting -> ready`, handshake packet, and ready-gated send/message delivery;
- duplicate `connect()` opens once; manual `disconnect()` never reconnects; reconnect revives it;
- transport factory/start/close, connect-timeout, and keepalive-timeout paths schedule exactly one
  retry; diagnostic transport errors alone do not start another retry path;
- deterministic capped jitter and reset only after ready;
- stale open/message/error/close callbacks from a retired transport do nothing;
- ready entry creates the current handler and starts keepalive by default; only validated incoming
  packets report `activity()`; periodic outbound writes cannot defer the first probe or its deadline;
- first idle invokes one fresh probe; activity while awaiting it does not extend the deadline;
  fulfillment cancels that deadline and starts a fresh idle window;
- deadline expiry, rejection, or synchronous throw terminally fails Keepalive and reconnects once,
  including when the failure handler awaits recovery;
- ready `probeNow()` invokes the injected probe immediately, repeated calls preserve pending work, and calls
  outside ready or with keepalive disabled are inert;
- back-to-back or re-entrant ready probes coalesce into one operation without a client-side queue;
- omitted keepalive options and `{}` use the built-in probe; a custom probe replaces only local
  checks; invalid durations and non-function custom probes throw before transport creation;
- server pings always receive matching pongs with default, disabled, and custom client probing;
  controls never reach application listeners, including unmatched/late pongs;
- matching is installed before write; only a matching pong fulfills the default probe, never a
  server ping or wrong ID; re-entrant replies cannot lose the result;
- server-reply write failures retire exactly once, including with `keepalive: false` or a custom probe;
- custom probes can exchange and validate payloads through the ordinary message seam;
- retirement aborts pending requests and disposes the handler before transport replacement;
  late settlement cannot recover or fail a newer generation; old handlers cannot write;
- rejected probe requests fail the current attempt without leaving a liveness timer armed;
- post-sleep recovery probes immediately through `net-monitor`; the configured response deadline or
  confirmed network replacement then follows the ordinary reconnect path;
- retryable versus non-retryable `connect_error`;
- malformed, oversized, binary, unsupported-version, and pre-ready packets fail closed;
- no application send queue; a transport write exception is caught and reported, and the client's
  public `send()` returns false on rejection and true on admission even if synchronous retirement
  follows; neither path reports liveness activity;
- listener failure isolation and idempotent terminal `stop()`;
- ready/message/error subscription wrappers preserve registration order and duplicate ownership,
  survive disconnect/reconnect, and cannot expose emission to subscribers;
- stop during nested event delivery suppresses all remaining callbacks; post-stop subscriptions
  and emissions are inert, and stale attempt callbacks cannot reach publication;
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
existing application's history and orchestration. Bazario composes one liveness orchestrator over
a reusable timer: `Keepalive` owns two `IdleWatchdog` instances and one promise probe at a time.
`RealtimeClient` owns the four-state connection lifecycle, inbound-activity classification, guarded
writes, and recovery. No timer coordination leaks into the parent's integration contract.

**Fixed client-initiated ping interval.** Rejected. It sends redundant traffic on an already-active
connection and synchronized clients can remain in lockstep. A one-shot watchdog moves the probe out
after each validated incoming packet. Outgoing-only traffic does not defer probing. Server-initiated pings are always answered by the internal
protocol handler while ready, independently of client probing configuration.

**Let keepalive or the watchdog close the transport.** Rejected. They cannot prove that a callback
still belongs to the current attempt. Only `RealtimeClient` owns generation-guarded retirement and
backoff.

**Copy Ringotel's full verification cadence into keepalive v1.** Deferred. Its `probeNow()`
invariant—do not replace a pending probe—and a distinct deadline are retained.
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

1. Accept this ADR using the accepted `Transport.md`, `IdleWatchdog.md`, `Keepalive.md`, and `Coordination.md` decisions.
2. Use the implemented transport adapters and keepalive orchestrator (with its internal watchdogs)
   through their public contracts. Use the implemented Coordination Emitter for the client's
   private ready/message/error registry.
3. Scaffold `packages/realtime/` with envelope types/validators, the four-state client, stub-transport
   tests, the internal abort-aware ping/pong handler, and attempt-local liveness composition.
   Keep the handler private until another consumer needs its contract.
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
- Bazario liveness probe boundary: `Keepalive.md`
- Bazario hierarchy and responsibility guide:
  [realtime client hierarchy](../../../docs/realtime-client-hierarchy.html)
- Ringotel reference: `/Users/alexus/Projects/Ringotel/web-app/src/shared/lib/realtime` and
  `/Users/alexus/Projects/Ringotel/web-app/src/shared/lib/reconnect`

## Summary

`@bazariodev/realtime` is one small logical JSON client with four states: `idle`, `connecting`,
`ready`, and `backoff`. It composes over the one-attempt `@bazariodev/transport` port and borrows
Socket.IO's handshake, intent, cleanup, and reconnect discipline. Attempt-local `Keepalive` owns
inactivity monitoring and abortable promise probes through two internal watchdogs. The internal
protocol handler supplies the default probe and always handles ping/pong while ready. Custom probes
replace only the client check; disabling keepalive preserves server-ping replies.
Keepalive fails terminally before notifying the parent and supports immediate wake/foreground checks.
Concrete platform mechanics remain below and queues, acknowledgements, retries, and recovery remain
above. `RealtimeClient` is the sole logical connection-lifecycle and transport-effect owner;
`auth-session`, `net-monitor`, `rpc`, and domain synchronization compose around it instead of being
absorbed into it.
