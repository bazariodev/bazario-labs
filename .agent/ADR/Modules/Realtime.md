# ADR: Lightweight Realtime Client

> **Historical decision superseded.** The current design is in
> [Realtime, Keepalive, and RPC Composition](./RealtimeComposition.md). This record preserves the
> earlier packet-channel and handshake design for history only.

- Status: Superseded by [RealtimeComposition](./RealtimeComposition.md)
- Date: 2026-09-03
- Revised: 2026-10-11

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

Build one package, **`@bazariodev/realtime`**, with a default `RealtimeClient` and an injected core.
The root `RealtimeClient(options)` keeps the default constructor. `createRealtimeClient(options,
overrides)` returns an instance of the root class with selected parts replaced. `createRealtimeParts(options,
overrides)` returns the assembled parts. The `@bazariodev/realtime/core` subpath exports the core
class as `RealtimeClient`; it takes `RealtimeClientParts<TConnection>` and has no imports from the
default implementation packages.

The core owns connection intent, the four-state lifecycle, event publication, retry decisions, and
the current attempt. One lifecycle, event publisher, and retry driver belong to one client. The
connection factory makes one connection for each attempt. The Keepalive factory makes one monitor
for each ready attempt. The default assembly uses `Fsm`, `Emitter`, `DefaultRetry`,
`ConnectionChannel`, and `Keepalive` for these roles. A custom connection receives semantic
`start()`, `sendMessage({ data, id? })`, and `dispose()` calls. It reports `onReady`, `onMessage`,
`onError`, and `onFailure` through handlers. The default `ConnectionChannel` wraps the selected
transport and owns the JSON handshake, validation, and packet channel.

`@bazariodev/keepalive` exports one `Keepalive`, which receives the current channel through DI.
It owns the packet subscription, unique request IDs, pong matching, peer replies, idle/response
watchdogs, and a terminal `onFail` event. RealtimeClient subscribes to failure and alone decides
whether to retire and replace the attempt. The former generic timing core and ping/pong wrapper
are merged; there is one pending operation, one lifecycle, and no public activity callback.

The root package uses `@bazariodev/fsm` for its lifecycle and `@bazariodev/fsm-delays` for reconnect delay, with
`@bazariodev/fsm-effects` supplying delays' required runtime peer. Each channel owns a connect
timeout so immediate replacement starts a fresh deadline. A private `Emitter` from
`@bazariodev/coordination` serves ready, message, error, packet, and state listeners. One channel spans both
`connecting` and `ready`.

The root package has five default runtime dependencies: `fsm`, `fsm-effects`, `fsm-delays`,
`keepalive`, and `coordination`. `transport` is a development dependency for the default adapter
tests. It is not a peer dependency. Applications install their chosen transport adapter as a
direct dependency. The core subpath imports no default implementation package.

## Architecture and ownership

```text
product/domain packages
        ↓ typed operations
@bazariodev/rpc
        ↓ client.channel (state / send / subscribe / subscribeState)
RealtimeClient (FSM, intent, current attempt, recovery)
        ├─ private Emitter (ready/message/error/packet/state subscriptions)
        ├─ ConnectionChannel (handshake, JSON, one packet send/subscribe seam)
        │     └─ injected Transport → selected adapter → realtime server
        └─ Keepalive (injected packet channel, ping/pong, deadlines; onFail → client)
              └─ two IdleWatchdogs
```

The default assembly owns the concrete `Fsm`, `Emitter`, retry driver, connection, and monitor
factories. Custom parts replace only the selected role. A custom connection must have a paired
Keepalive factory or explicit `null`. `createKeepalive: null` omits the monitor and its built-in
server-ping replies. `keepalive: false` keeps the default Keepalive packet responder but disables
client probes. `retry: null` omits automatic retry; a terminal failure clears intent, returns to
`idle`, and allows a later manual `connect()`.

The application imports `realtime` and its chosen adapter. Package dependencies point inward:

- `transport` contains the one-attempt contract and platform adapters, with no runtime dependencies;
- `idle-watchdog` has no runtime dependencies; `keepalive` depends only on `idle-watchdog`;
- `coordination` supplies independent primitives and has no runtime package dependencies;
- `realtime` directly depends on `fsm`, `fsm-effects`, `fsm-delays`, `keepalive`, and `coordination`;
- `transport` is a local dev dependency for default adapter tests; applications install their chosen
  adapter directly; `idle-watchdog` is transitive through `keepalive`;
- `rpc` consumes the public `client.channel` metadata/lifecycle port, never a raw transport.
  That port exposes message IDs internally while application-facing RPC methods hide them.

Cross-cutting modules stay outside the message path. `auth-session` supplies fresh credentials for
the next attempt. `net-monitor` requests `probeNow()` after visibility or sleep/wake changes and
`reconnect()` after confirmed network replacement. `fsm-react` and `fsm-inspect` observe the
structural snapshot. None may retain or replace the transport.

The ownership rule is: **transport owns a physical attempt; the channel owns handshake and framing;
Keepalive owns liveness exchange and timing; RealtimeClient owns the
logical connection and recovery; higher layers own application delivery semantics.** See
`Transport.md`, `IdleWatchdog.md`, and `Keepalive.md` for the narrower contracts.

## Socket.IO ideas: take and leave

| Socket.IO idea | Bazario v1 |
| --- | --- |
| separate physical transport from logical client | take: a minimal one-attempt `Transport` port |
| transport open is not application ready | take: wait for a server `ready` packet |
| explicit active/manual-disconnect distinction | take: private desired-connected intent |
| one reconnect loop with capped jittered backoff | take |
| ping/pong liveness | one Keepalive owns control exchange and bounds one pending probe |
| connection-attempt timeout | take |
| cleanup subscriptions and ignore stale engines | take: current-attempt identity guards and terminal disposal |
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
  | Readonly<{ type: 'connect'; id?: string; protocol: 1; auth?: JsonValue }>
  | Readonly<{ type: 'ping'; id: string }>
  | Readonly<{ type: 'pong'; id: string }>
  | Readonly<{ type: 'message'; id?: string; data: JsonValue }>;

type ServerPacket =
  | Readonly<{
      type: 'ready';
      id?: unknown;
      protocol: 1;
      connectionId: string;
    }>
  | Readonly<{ type: 'ping'; id: string }>
  | Readonly<{ type: 'pong'; id: string }>
  | Readonly<{ type: 'message'; id?: unknown; data: JsonValue }>
  | Readonly<{
      type: 'connect_error';
      id?: unknown;
      code: string;
      message?: string;
      retryable: boolean;
    }>;
```

Handshake:

1. the injected transport opens;
2. the channel sends one `connect` packet, resolving `auth` fresh for this attempt;
3. the server sends `ready` or `connect_error`; each attempt has its own transport;
4. only `ready` moves the client to the sendable `ready` state.

Only ping/pong require a non-empty string `id`: the backend echoes `ping.id` in `pong` and creates
fresh IDs for its own pings. IDs on connect, ready, connect_error, and message are optional.
Outgoing IDs must be non-empty strings. Incoming handshake IDs are ignored; incoming message IDs
are opaque metadata exposed as `unknown`, preserving numeric, null, and other values without coercion.
There is no handshake-ID echo requirement or matcher; each attempt has a fresh transport carrying
one connect handshake.

`requestIds` defaults to false. When true, the client adds generated IDs to outgoing connect/message
packets for backend log tracing. The flag does not require inbound IDs or disable control IDs.
This preserves interoperability with servers that omit IDs or use other ID formats on non-control packets.
`send()` retains its boolean admission result and `onMessage` exposes only `message.data`.
`client.channel` supplies `{ id?, data }` plus lifecycle notifications to RPC. Its sends preserve
explicit IDs and leave notifications ID-less regardless of the tracing flag. RPC generates an ID
for every request, and the backend echoes it on the result/error response. The application-facing
RPC API hides those IDs. Tracing alone does not implement response correlation.
RPC narrows incoming IDs to non-empty strings before matching; unsupported IDs neither resolve a
request nor become ID-less notifications. Only the RPC operation times out if no matching response
arrives; unrelated message metadata never terminates the connection.
Invalid or missing ping/pong IDs and numeric overflow in application data (for example
`1e999` parsing as Infinity) are non-retryable protocol errors.

The default assembly owns the optional `createRequestId` function and shares it with the default
connection and Keepalive. It supplies this function as the core's `createMessageId` only when
`requestIds: true`. The injected core does not create a separate Keepalive ID generator. Built-in
pings always invoke the shared function; connect/message packets invoke it only with
`requestIds: true`. It runs without a receiver and returns a fresh non-empty string unique across
requests, clients, and reconnects. The default is `crypto.randomUUID()` with a timestamp/random
fallback. Invalid results or thrown errors prevent writes and follow the operation's connection,
send, or keepalive error policy. Pongs reuse the peer's ID. Raw transports neither generate nor
interpret IDs.

A `ready` packet starts one attempt-local `Keepalive` before the client publishes ready.
Root-level `ping` and `pong` packets are legal only after readiness and require a non-empty string
`id`. Keepalive observes every validated packet for activity and matches only control pongs.
RealtimeClient separately delivers
`message.data` to application subscribers, even when that data happens to look like ping or pong.
A look-alike application value never triggers a peer reply or fulfills a liveness probe. The packet
subscriber also receives valid `message` packets so inbound application traffic resets the idle
window. All validated incoming traffic, including unmatched controls, counts as activity;
outgoing writes do not prove peer reachability.

Keepalive creates a unique ID for each ping and records its matcher before writing it, so a
synchronous pong cannot be lost. One channel subscription serves the entire instance; no per-probe
subscription or abort listener is needed. Only a matching top-level pong from the current channel fulfills the promise.
Wrong IDs, late pongs, peer pings, and application data cannot fulfill it. Keepalive answers
peer pings with a top-level pong even when local probing is disabled or replaced by a custom
`keepalive.probe(signal)`. A failed peer reply emits `onFail`; Keepalive itself never
reconnects. The same Keepalive bounds each local check with `deadlineMs`, invalidates pending
matching on retirement, and aborts pending custom work.

`RealtimeClient.probeNow()` requests an immediate check only while ready. It is inert if local
monitoring is disabled. `net-monitor` can invoke it after wake/visibility changes or call
`reconnect()` after confirmed network replacement. Browser timer throttling can delay a scheduled
idle probe, so `probeNow()` is a useful explicit recovery seam.

`auth` is opaque JSON resolved for every attempt. Realtime places it in the connect packet but
does not store, refresh, or log credentials. URL, subprotocol, TLS, and platform headers belong
to the selected transport adapter and deployment.

## Public API

These types describe the implemented root and core APIs. The full public declarations are in
`packages/realtime/src/index.d.ts` and `packages/realtime/src/core.d.ts`.

```ts
type RealtimeState = 'idle' | 'connecting' | 'ready' | 'backoff';

type RealtimeContext = Readonly<{
  attempt: number; // 0 initially; 1 for the first retry
  connectionId: string | null;
}>;

type RealtimeSnapshot = Readonly<{
  value: RealtimeState;
  previousValue: RealtimeState | null;
  context: RealtimeContext;
  version: number;
}>;

type ReconnectOptions = Readonly<{
  initialDelayMs?: number; // default 500
  maxDelayMs?: number;     // default 30_000
  factor?: number;         // default 2
}>;

type RealtimeKeepaliveOptions = Readonly<{
  idleMs?: number | (() => number); // default 30_000; optionally draw each idle window
  deadlineMs?: number; // default 30_000; maximum wait for each probe
  probe?: (signal: AbortSignal) => Promise<void>; // Replaces the default check.
}>;

type RealtimeClientError = Readonly<{
  kind: 'connection' | 'protocol' | 'keepalive' | 'send';
  message: string;
  cause?: unknown;
}>;

type RealtimeClientOptions = Readonly<{
  createTransport: () => RealtimeTransport;
  requestIds?: boolean; // Default false; adds outgoing connect/message tracing IDs.
  createRequestId?: RequestIdGenerator; // Always used for built-in pings.
  auth?: () => JsonValue | undefined;
  reconnect?: ReconnectOptions;
  keepalive?: RealtimeKeepaliveOptions | false; // Default on; false disables client probes only.
  connectTimeoutMs?: number; // default 10_000; includes the ready handshake
  maxMessageBytes?: number;  // default 1 MiB
  scheduler?: RealtimeScheduler;
  random?: () => number;
  logger?: RealtimeLogger;
}>;

class RealtimeClient {
  constructor(options: RealtimeClientOptions); // Root entry: default assembly.

  readonly snapshot: RealtimeSnapshot;
  readonly state: RealtimeState;
  readonly channel: RealtimeMessageChannel;

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

type RealtimeMessageChannel = Readonly<{
  readonly state: RealtimeState | 'stopped';
  send(message: Readonly<{ data: JsonValue; id?: string }>): boolean;
  subscribe(listener: (message: Readonly<{ data: JsonValue; id?: unknown }>) => void): Unsubscribe;
  subscribeState(listener: (state: RealtimeState | 'stopped') => void): Unsubscribe;
}>;
```

The root entry also exports `createRealtimeClient(options, overrides)` and
`createRealtimeParts(options, overrides)`. The first returns an instance of the root
`RealtimeClient` wrapper. The second returns `RealtimeClientParts<TConnection>` for the core entry.
The default overload
requires `createTransport`. A custom connection can omit it, but must also provide a paired
`createKeepalive` factory or `null`. The types reject a monitor for a different connection type.

The core entry exports the injected class as `RealtimeClient`:

```ts
import { RealtimeClient as RealtimeCore } from '@bazariodev/realtime/core';
import type { RealtimeClientParts } from '@bazariodev/realtime/core';

declare const parts: RealtimeClientParts;
const client = new RealtimeCore(parts);
```

`RealtimeClientParts<TConnection>` requires five parts: `lifecycle`, `events`,
`createConnection`, `createKeepalive`, and `retry`. The last two can be `null`, but their keys must
be present. The parts can also supply `createMessageId` and `logger`.

`lifecycle` exposes `state`, `snapshot`, `send(event)`, and `subscribe(listener)`. Its events are
`CONNECT`, `RECONNECT`, `DISCONNECT`, `READY` with `connectionId`, `FAIL`, and `RETRY` with the
snapshot `version`. A commit increases the version and keeps each snapshot stable. Subscribers get
future commits only. A nested send suppresses later delivery of the obsolete snapshot.

`events` is a typed publisher with `on`, `emit`, and `stop`. Its event map is `ready`, `message`,
`error`, `packet`, and `state`. A ready payload has `connectionId` and `reconnect`; a message payload
is JSON data; a packet payload preserves its optional opaque ID; a state payload is a snapshot or
`stopped`. It must isolate listener errors. `stop()` and unsubscribe are idempotent and do not throw.

`createConnection(handlers)` returns an inert semantic connection. It must not call a handler before
`start()`. The core registers the attempt first and then calls `start()`. A callback may run before
`start()` returns. Factories run without a receiver. `sendMessage({ data, id? })` sends JSON data and
optional non-empty string metadata. `onMessage` reports `{ data, id? }` and keeps an incoming ID
opaque. Only JSON values are valid. Application send admission is ready-only.

`createKeepalive(connection)` returns a ready-attempt monitor with `start`, `probeNow`, `onFail`, and
`stop`. The core subscribes before it starts the monitor. `retry.start(source, handlers)` receives a
readonly snapshot source and `onRetry(version)` / `onError(cause, version)`. It cannot send lifecycle
events. Retry callbacks are asynchronous, including a zero-delay retry. Each report carries the
version that scheduled it. The core ignores a report from a retired version.

Use TypeScript 5.4 or later for `NoInfer`, which keeps the connection and monitor types paired:
[TypeScript 5.4 NoInfer](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html#the-noinfer-utility-type).

`createTransport()` is called once per attempt and returns a fresh, unstarted `Transport`.
Construction or `start()` failure enters the ordinary recovery path. When the default monitor
factory is selected, each ready handshake creates a fresh `Keepalive` bound to that connection's
packet channel. The core subscribes to `onFail` and starts it before public ready notification.
`keepalive: false` disables local idle and immediate probes while the default Keepalive still
answers peer pings. `createKeepalive: null` omits the monitor and its peer-ping replies. A custom
probe replaces only the default outgoing check. Every default Keepalive receives the ready
connection's validated packet channel.

Listener registration returns its cleanup function; paired `onX`/`offX` methods and a separate
public notifier object add no value. Internally, `onReady`, `onMessage`, and `onError` delegate to
one private Emitter following the [Coordination ADR](Coordination.md). The channel's packet and
state subscriptions use the same Emitter. The client alone can emit;
subscribers receive only the owner's
subscription methods. `onReady`, `onMessage`, `onError`, and `channel.subscribe` share a
registration when the same listener is registered twice. Each `channel.subscribeState` call
registers separately because it wraps the listener to check the current snapshot.
Stale unsubscribe handles cannot remove a later shared registration.

The emitter belongs to the logical client and survives disconnect and reconnect. Terminal
`stop()` stops reconnect timers and retires the attempt. It then emits `stopped` to channel
state listeners and disposes the emitter. Disposal suppresses callbacks that remain in an
emission in progress. Subscription changes otherwise affect the next emission. The client
checks the current attempt before it publishes events; the emitter owns no connection policy.
No Queue or executor is needed for this integration.

State observation retains the existing `FsmSubscribable` shape and latest-snapshot semantics, so
`fsm-react` and `fsm-inspect` work without realtime-specific bindings.

## Lifecycle and invariants

```text
idle --connect--> connecting --ready packet--> ready
                         |                       |
                         +--failure/timeout------+--> backoff --delay--> connecting

any state --disconnect--> idle
any state --reconnect--> connecting (connect from idle; replace active attempts without delay)
```

- `connect()` is idempotent, sets desired-connected intent, and never opens a second concurrent
  transport attempt.
- `disconnect()` is restartable: it clears intent and backoff, retires the transport gracefully,
  clears the connection id, resets the attempt counter, and returns to `idle`.
- `reconnect()` sets connection intent. From idle it connects. In other states it cancels any
  delay, retires the current channel, and starts a new attempt immediately.
- `probeNow()` is the non-destructive wake/foreground seam. It is a guarded delegation to the current
  Keepalive instance only while ready; it never changes connection intent or replaces an attempt by itself.
- An unexpected connection, handshake, or keepalive failure enters `backoff` only while intent is
  true and a retry driver is present. With `retry: null`, failure clears intent and returns to
  `idle`; a later `connect()` is allowed. A non-retryable `connect_error` also clears intent and
  returns to `idle`.
- Backoff is `random() * min(maxDelayMs, initialDelayMs * factor^(attempt - 1))`. Only a valid `ready`
  packet resets the attempt counter. Reconnect continues until explicit disconnect, stop, or a
  non-retryable server verdict; v1 has no arbitrary max-attempt flag that can strand a session.
- Current-channel identity guards recovery and ready publication. Retirement clears the current
  reference before stopping Keepalive and closing and disposing the transport. Old callbacks
  cannot affect a new channel.
- A generation guard makes the newest reentrant command win. If a listener or cleanup callback
  calls `disconnect()`, `reconnect()`, or `stop()`, an older outer operation cannot start or publish
  work for the retired attempt.
- Transport `onError` is diagnostic and does not independently schedule reconnect. Terminal
  `onClose`, connect timeout, handshake failure, or keepalive timeout/error
  retires the attempt and schedules at most one reconnect. Keepalive is already terminal before its
  failure notification; recovery cannot race an automatic next round.
- Incoming packets are size-checked, parsed, and validated before any application listener runs.
  Malformed, oversized, binary, or unsupported-version packets, and application messages or ping/pong
  before readiness, are protocol errors: retire the transport, stop automatic retry, return to `idle`, and notify `onError`.
- Listener exceptions are caught and logged independently. They never become protocol/transport
  failures and never stop delivery to later listeners.
- Attempt retirement clears the channel reference, stops Keepalive to abort
  any probe, and closes and disposes the channel's transport. Start Keepalive before notifying
  `onReady` listeners; late settlement cannot affect a new attempt.
- `stop()` is terminal and idempotent. It marks the client stopped before external cleanup, clears
  intent, retires the attempt, stops retry, and releases listeners. Public snapshot subscribers see
  the final `idle` snapshot. `channel.state` reports `stopped`. Methods are inert afterward and
  `send()` returns `false`.

## Send and delivery semantics

`send()` succeeds only in `ready`. It accepts only a JSON value and a non-empty string ID when one
is supplied. It JSON-encodes one `message` packet, rejects a packet above
`maxMessageBytes`, and hands the text to the current transport. `transport.send()` returns no value
on acceptance and throws on rejection. The public method returns `true` after accepted admission,
even if the attempt retires synchronously during that call. It returns `false` before readiness,
during retirement, on invalid JSON, on oversize packets, or when the transport rejects the write;
write failures emit a diagnostic `send` error. Neither accepted nor rejected writes extend idleness.

`channel.send({ data, id? })` follows the same JSON and ready checks. It preserves the supplied ID
and never generates one. `send()` uses `createMessageId` only when the assembled parts provide that
factory. Missing `createMessageId` disables public-send tracing. The default assembly supplies it
only when `requestIds: true`. The generated ID must also be a non-empty string.

The channel's packet writer uses the same bounded serialization and disposal guard. A control write
never goes through the application's `message` envelope or `onMessage` stream. A failed local ping
rejects its probe; Keepalive performs cleanup and emits `onFail`.
A failed peer-pong reply follows the same failure path even if local probing is disabled or custom. RealtimeClient
makes one current-attempt recovery decision. An application send error alone does not reconnect.

The client has **no application outbound queue**. It cannot know whether a request is idempotent,
whether a presence update is obsolete, or whether a chat message belongs in a durable outbox. It also
cannot know whether a frame handed to the browser immediately before disconnect reached the server.
Blind replay would therefore create stale bursts and possible duplicates while still not offering a
delivery guarantee.

v1 guarantees only the in-attempt ordering required by the transport contract. Arrival is
at-most-once. The implemented `rpc` package adds correlation, bounded READY/response waiting,
cancellation and notifications; it never retries or replays. Chat may add durable ids/outbox behavior. On every `onReady`, consumers that depend on
server state must run their own snapshot/delta synchronization because events missed while
disconnected are not silently reconstructed.

## Scope

In v1:

- transport-neutral bounded JSON packets and connect/ready/error/ping/pong control packets;
- four-state FSM, connect timeout, automatic reconnect, capped jitter, force reconnect;
- one attempt-local Keepalive with ping/pong, idle/deadline watchdogs and an optional custom probe;
- immediate ready-state liveness probing without waiting for the idle scheduler;
- stale-attempt protection, sendability guard, deterministic injected transport/time/random;
- observable snapshots plus ready/message/error subscriptions;
- direct runtime dependencies on `fsm`, `fsm-effects`, `fsm-delays`, `keepalive`, and `coordination`;
  `transport` is a development dependency for adapter tests, and `idle-watchdog` is transitive
  through `keepalive`;

Not in v1:

- namespaces, rooms, multiplexing, binary attachments, custom parsers;
- concrete transports, transport selection, live upgrades, or adapter-specific options;
- application message buffering, acknowledgement, retries, deduplication, persistence, or recovery;
- auth refresh/session ownership, browser online/visibility/sleep detection, RPC, presence, or chat.

`auth-session` owns credentials. `net-monitor` detects online/visibility/wake and calls the public
`probeNow()` or `reconnect()` seam; it does not mutate internal timers. `rpc` owns application
request/response semantics. Domain packages own resynchronization and durable delivery.

## Validation and testing

Default assembly validates only the options for the defaults that it selects. It validates resource
limits when it selects the default connection, reconnect bounds when it selects the default retry,
and keepalive durations when it selects the default monitor. A custom connection does not need
`createTransport`, auth, or default packet size options. A custom or omitted monitor does not need
default keepalive options. A custom or omitted retry driver does not need default reconnect or
random options. Construction validates selected default options before any transport is created. A
private `isTimerMs` predicate checks integer durations from 1 through
2_147_483_647 for connect timeout, reconnect delays, and fixed keepalive idle/deadline options.
An idle duration function is evaluated and validated only when its watchdog is armed. No
throwaway Keepalive instance, watchdogs, or inert channel is needed. Each ready attempt creates its
own Keepalive with the actual channel. With `keepalive: false`, local durations are not validated.

A supplied custom `keepalive.probe` other than `undefined` must be a function: reject invalid
configuration with TypeError at construction. Omitted/undefined selects the built-in probe.
Keepalive itself retains its typed contract and reports invocation errors when a check runs.

Concrete adapter construction/security belong to that adapter. The channel validates packet
shapes and ping/pong IDs; Keepalive matches controls. Custom probes validate their own payloads. Errors
expose safe categories and causes. Realtime does not log protocol packets, auth, adapter options,
or payloads. Forward the configured logger to Keepalive so listener failures retain their original
cause; the application chooses diagnostics and any redaction. Recovery must complete before calling
external error listeners, so a listener exception cannot leave a failed attempt active.

Required public-behavior tests:

- `idle -> connecting -> ready`, handshake packet, and ready-gated send/message delivery;
- duplicate `connect()` opens once; manual `disconnect()` never reconnects; reconnect revives it;
- transport factory/start/close, connect-timeout, and keepalive-timeout paths schedule exactly one
  retry; diagnostic transport errors alone do not start another retry path;
- deterministic capped jitter; only ready resets the counter within a retry loop;
- stale open/message/error/close callbacks from a retired transport do nothing;
- ready entry creates and starts the current Keepalive instance; only validated incoming packets
  report activity; periodic outbound writes cannot defer the first probe or its deadline;
- first idle invokes one fresh probe; activity while awaiting it does not extend the deadline;
  fulfillment cancels that deadline and starts a fresh idle window;
- deadline expiry, rejection, or synchronous throw terminally fails Keepalive and reconnects once;
- ready `probeNow()` invokes the injected probe immediately, repeated calls preserve pending work, and calls
  outside ready or with keepalive disabled are inert;
- back-to-back or re-entrant ready probes coalesce into one operation without a client-side queue;
- omitted keepalive options and `{}` use the built-in probe; a custom probe replaces only local
  checks; invalid durations and non-function custom probes throw before transport creation;
- server pings always receive matching pongs with default, disabled, and custom client probing;
  controls never reach application listeners; application ping-shaped data causes no peer reply;
- matching is installed before write; only a matching top-level pong fulfills the default probe,
  never a server ping, wrong ID, or application pong-shaped value; re-entrant replies cannot lose it;
- server-reply write failures retire exactly once, including with `keepalive: false` or a custom probe;
- custom probes can exchange and validate payloads through the ordinary message seam;
- retirement aborts pending requests and disposes Keepalive before transport replacement;
  late settlement cannot recover or fail a newer attempt; old channels cannot write;
- rejected probe requests fail the current attempt without leaving a liveness timer armed;
- post-sleep recovery probes immediately through `net-monitor`; the configured response deadline or
  confirmed network replacement then follows the ordinary reconnect path;
- retryable versus non-retryable `connect_error`;
- malformed, oversized, binary, unsupported-version, and pre-ready packets fail closed;
- missing or invalid ping/pong IDs fail closed; non-control IDs stay optional and opaque;
- `requestIds` is off by default; opt-in tracing adds outgoing connect/message IDs;
- non-finite numbers in inbound application data fail closed;
- `client.channel` preserves explicit IDs, omits IDs on notifications, reports state changes,
  and never delivers ping/pong packets;
- a real top-level pong can fulfill a probe; application pong-shaped data cannot;
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
`RealtimeClient` owns the four-state connection lifecycle and recovery. Its channel owns
validation and guarded writes; Keepalive derives activity from the channel subscription. No timer coordination leaks into the parent's integration contract.

**Fixed client-initiated ping interval.** Rejected. It sends redundant traffic on an already-active
connection and synchronized clients can remain in lockstep. A one-shot watchdog moves the probe out
after each validated incoming packet. Outgoing-only traffic does not defer probing. Keepalive
answers server pings while ready, independently of client probing configuration.

**Carry ping/pong inside application message data.** Rejected after testing. It made every app
listener see liveness values. An application `ping` value triggered an automatic reply, and an
application `pong` value with a matching ID could falsely satisfy a probe. A separate top-level
control lane preserves ordinary application data and leaves ping/pong ownership with Keepalive.

**Remove ping/pong types after adding IDs.** Rejected. Correlation does not identify the packet's
role: an unmatched ID can be a new peer request or a delayed response. Treating every unmatched
ID as a request creates echo loops; ignoring it drops peer pings. A same-ID peer ping is still a
request, not a response to our pending check. Keep explicit control types and required control IDs together.

**Let keepalive or the watchdog close the transport.** Rejected. They cannot prove that a callback
still belongs to the current attempt. Only `RealtimeClient` owns current-attempt retirement and
backoff.

**Copy Ringotel's full verification cadence into keepalive v1.** Deferred. Its `probeNow()`
invariant—do not replace a pending probe—and a distinct deadline are retained.
A random idle window is now opt-in through coordination's timer-free `createJitter` and an injected
idle duration function. The configurable unanswered-ping budget and accelerated verification mode
remain deferred. Direct transport access and a close callback would duplicate lifecycle ownership.

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
- `rpc` and future auth, net-monitor, and domain packages compose over narrow public seams.

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
2. Release the implemented `packages/realtime/` client and its channel, control-lane tests,
   declarations, and changeset after review. Its manifest starts at 0.0.0 with an initial minor
   changeset, producing 0.1.0 including the pending Keepalive dependency update. Let Changesets
   generate the initial changelog. The breaking Keepalive changeset remains major (1.0.0).
3. Add the matching protocol endpoint to `examples/server` and prove network/sleep recovery.
4. Release the implemented `@bazariodev/rpc` over `client.channel`; validate its protocol adapter
   against a real Ringotel endpoint before migrating the app. See `Rpc.md` for acceptance coverage.
5. Extract `fsm-retry` only after the inline backoff has been proven here.

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
Socket.IO's handshake, intent, cleanup, and reconnect discipline. One private channel per attempt
separates application messages from validated control packets. One injected-channel Keepalive owns
top-level ping/pong exchange, inactivity, and probe deadlines through two watchdogs. Custom probes replace only the client check; disabling local monitoring preserves
server-ping replies.
Keepalive fails terminally before notifying the parent and supports immediate wake/foreground checks.
Concrete platform mechanics remain below and queues, acknowledgements, retries, and recovery remain
above. `RealtimeClient` is the sole logical connection-lifecycle and transport-effect owner;
`auth-session`, `net-monitor`, `rpc`, and domain synchronization compose around it instead of being
absorbed into it.
