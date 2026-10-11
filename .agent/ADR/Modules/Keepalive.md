# ADR: Keepalive Channel Liveness

> **Historical decision superseded.** The current probe-only Keepalive contract is in
> [Realtime, Keepalive, and RPC Composition](./RealtimeComposition.md). This record preserves the
> earlier packet-channel, ping, and pong design for history only.

- Status: Superseded by [RealtimeComposition](./RealtimeComposition.md)
- Date: 2026-09-13
- Revised: 2026-10-11

## Context

A ready connection can outlive its peer. Its liveness monitor needs an idle window, a correlated
request/response check, and a bounded response deadline. The initial Keepalive accepted a generic
promise probe. Realtime then added PingPongKeepalive around it to own packets and correlation.
Both classes tracked start/stop, pending work, listeners, and terminal failure. The wrapper also
translated onFail into onUnhealthy without adding a separate connection policy.

## Decision

Merge those lifecycles into one public `Keepalive`. Inject one ready, attempt-bound packet channel.
Keepalive owns its subscription, ping IDs, pong matching, peer replies, idle/deadline watchdogs,
optional custom probe, and a single terminal `onFail` event. The owner alone replaces connections.

This deliberately revises the earlier generic probe-only API. There is no compatibility mode and
no separate PingPongKeepalive export. Custom probes remain an optional replacement for the local
ping check on the same channel. `activity()` becomes private because packet delivery proves activity.

```text
RealtimeClient (readiness, current attempt, recovery)
  ├─ ConnectionChannel (transport, handshake, JSON validation, packet subscriptions)
  └─ Keepalive (injected channel, ping/pong, one pending check, onFail)
       └─ two IdleWatchdogs (idle and response windows)
```

`keepalive` depends only on `idle-watchdog`. The channel is a structural interface owned by the
consumer; Keepalive does not import realtime or a concrete transport. Raw `Transport.start(handlers)`
and byte framing stay below the packet channel. Keepalive neither starts nor closes a transport.

## Public contract

Canonical declarations live in `packages/keepalive/src/index.d.ts`. The interface is:

```ts
type KeepaliveControlPacket = Readonly<{ type: 'ping' | 'pong'; id: string }>;
// Activity type names are a finite union; only controls require IDs. Activity metadata is opaque.
type KeepalivePacket<ActivityType extends string = 'message'> =
  | KeepaliveControlPacket
  | Readonly<{
      type: string extends ActivityType ? never : Exclude<ActivityType, 'ping' | 'pong'>;
      [key: string]: unknown;
    }>;
type RequestIdGenerator = () => string; // Fresh, non-empty, unique across requests and attempts.

type KeepaliveChannel<ActivityType extends string = 'message'> = Readonly<{
  send(packet: KeepaliveControlPacket): void;
  subscribe(listener: (packet: KeepalivePacket<ActivityType>) => void): () => void;
}>;

type KeepaliveProbe = (signal: AbortSignal) => Promise<void>;
type KeepaliveFailure =
  | Readonly<{ type: 'timeout' }>
  | Readonly<{ type: 'error'; error: unknown }>;
```

The constructor requires `channel`. Monitored instances also require `idleMs` and `deadlineMs`,
with optional `probe`, `createRequestId`, `scheduler`, and `logger`. `monitor: false` needs neither
duration and creates no watchdogs; it keeps the packet subscription and server-ping replies.
`idleMs` may be a fixed number or a duration function, for example coordination's `createJitter`.
Functions are evaluated once per idle arm, and their result is validated before scheduling. Failures
follow the normal terminal cleanup path. The response deadline is always a fixed positive duration.

Methods are `start()`, `probeNow()`, `onFail(listener)`, `stop()`, and `[Symbol.dispose]()`. Construction
is inert; start is explicit and idempotent. All later methods are inert after terminal cleanup.

## Validation boundary

The channel decodes and validates all packets before publication, including control types and
non-empty string IDs on ping/pong. Non-control traffic needs no ID. It includes valid non-control packets for inactivity
accounting. Payload fields are opaque and cannot be interpreted as control packets.

Keepalive trusts the typed packet contract. It dispatches on `type` and matches IDs without repeating
object, array, and string validation. The `ping` branch is required: server probes must still receive
responses when local probing is disabled. Unique request IDs do not remove packet direction/type
semantics or stale-attempt guards.

The declarations parameterize non-control type names, defaulting to `message`. A finite type union
such as `presence | event` lets other channels carry their own packets without fabricating IDs.
An unrestricted `string` cannot form the non-control branch: it would also admit an ID-less pong.
This parameter is erased at runtime and does not change packet processing.

Private `options.js` contains configuration checks; `request-id.js` validates generated IDs. Duration validation stays in IdleWatchdog.
Lifecycle guards stay beside the state changes and I/O they protect. Extracting them into predicates
would obscure the relationship between pending-operation identity, cancellation, and settlement.

## Lifecycle and timing

1. `start()` subscribes to the channel and arms the idle watchdog. Repeated starts do not reset it.
2. Each validated inbound packet refreshes the idle window while no probe is pending. Outbound
   writes never refresh it.
3. Idle expiry or `probeNow()` records one pending operation, cancels idle monitoring, and arms
   the response watchdog before calling the probe or writing the ping.
4. A built-in check records a fresh ID and resolver before sending. Only a matching top-level pong
   resolves it; wrong IDs, peer pings, and application messages do not. The default generator uses
   `crypto.randomUUID()` with a timestamp/random fallback. An injected generator must return a
   fresh non-empty ID unique across attempts and is called without a receiver.
5. Fulfillment is observed in a promise reaction, preserving coalescing through synchronous replies.
   It clears the pending record and response deadline, then starts a fresh idle window.
6. Timeout, rejection, synchronous probe error, subscription error, or failed peer reply performs
   terminal cleanup and publishes one failure. Explicit stop performs cleanup without failure.

Incoming traffic cannot extend a pending response deadline. Server pings always receive matching
pongs through the same channel writer, including with a custom probe or `monitor: false`.
A write returns normally on admission and throws on rejection; Keepalive ignores return values.

## Cancellation and deadline ownership

One pending record holds the request ID, resolver, and AbortController. There is no second ping
handler, per-probe subscription, abort listener, or independent deadline. The channel subscription
lasts for the instance. Keepalive removes it on stop or failure.

Custom probes receive a fresh signal and must honor abort and await a validated response. They
must not add retry or replay across attempts. An RPC probe may keep its ordinary request timeout,
while the Keepalive deadline aborts the signal independently. A correlated server error may prove
liveness; it remains an application error for normal RPC requests. Both promise handlers are attached even if the probe
stops Keepalive before returning. Late fulfillment/rejection cannot alter another pending operation.
The successful operation's signal is not later aborted.

Cleanup marks the instance stopped and invalidates its pending record before canceling watchdogs,
unsubscribing, and aborting custom work. Failure publication follows cleanup. Reentrant abort
callbacks cannot restart monitoring or create another failure.

Subscription registration must return before delivering packets or calling back into Keepalive.
The channel may deliver synchronously during `send()`; the matcher is recorded before writing.
Failure publication is synchronous after cleanup, with no deferred subscription-failure state.
A request-ID callback that stops the instance prevents its ping write. The channel writer also
guards its connection lifetime before transport admission.

## Validation, failures, and subscriptions

Constructor checks reject missing channel methods and invalid callback types with TypeError.
Monitored durations are integers from 1 through 2_147_483_647, validated by IdleWatchdog. A custom
probe returning a non-promise fails as an operation error and aborts its pending signal.

Scheduler methods and unsubscribe functions must not throw. If channel subscription throws, it
must release resources allocated before the throw. Keepalive contains that error and reports failure.
The logger's error method must not throw; it records failure-listener exceptions with their cause.

Failure listeners are snapshotted before cleanup. Notification finishes in registration order even
if an abort callback or listener unsubscribes or stops. Duplicate listeners share ownership; stale
unsubscribe handles cannot delete a later registration. New subscriptions after stop are inert.

## Realtime integration

On each ready handshake, RealtimeClient creates `new Keepalive({ channel: attempt, ...options })`,
subscribes to `onFail`, and starts it before publishing ready. `keepalive: false` maps to
`monitor: false`; a custom probe changes only the outgoing check. The client invalidates its current
channel reference before stopping Keepalive and disposing the channel.

Realtime validates configured durations before transport creation with a private timer-duration
predicate. No temporary Keepalive or inert channel is allocated for configuration validation.
RealtimeClient owns the optional request-ID factory, always using it for built-in Keepalive
pings and optionally sharing it with connect/message packets when `requestIds: true`. That flag
defaults to false; it never disables control IDs. Standalone Keepalive has its own default generator. Both
factories return fresh non-empty strings unique across requests, clients, and attempts; invalid
results fail before writing. Backend pongs echo the received ping ID, without generating a new one.
The transport does not generate or interpret IDs. Every ready connection receives its own Keepalive.
The channel validates packets; RealtimeClient routes application messages and owns recovery.

## Migration and release

The next keepalive release carries a major changeset for the required channel and removal of
public `activity()`. Callers must provide validated packet delivery instead of manually reporting
traffic with required non-empty IDs on ping/pong only. Custom probe callback types are checked at construction. No release is performed
as part of this refactor.

## Verification

Preserve existing deadline, coalescing, custom-probe cancellation, late-settlement, and failure
subscription tests through the new channel API. Packet tests cover unique/injected IDs, immediate
responses, duplicate/late/wrong pongs, application look-alikes, peer replies with monitoring disabled,
rejected writes, cleanup before failure notification, and stop during request-ID generation. Realtime tests
cover attempt replacement and the real WebSocket adapter integration. Check both DOM and WebWorker
public declarations, ESM/CommonJS builds, lint, and the workspace suite.
