# ADR: Keepalive Module

- Status: Proposed
- Date: 2026-09-13
- Revised: 2026-09-14

## Context

An idle socket may still look open after a network break or laptop sleep. A small ping/pong exchange
can test the quiet connection, but transport access, inactivity timing, packet shape, and reconnect
policy are separate concerns.

The keepalive abstraction should know only the ping/pong conversation:

1. an idle signal requests a correlated ping;
2. an explicit immediate check can request the same probe without waiting for idleness;
3. a matching pong completes the pending probe;
4. a configurable response deadline reports a missing pong;
5. after reporting a timeout, another correlated round starts unless an owner stopped the instance;
6. an optional peer ping is converted into a pong request.

It must not own a transport, send directly, reset an idle timer, close a socket, or reconnect a
client. `RealtimeClient` owns those effects because it owns the current transport attempt and is the
only component that can guard them against stale generations.

## Decision

Build **`@bazariodev/keepalive`** as a dependency-free, protocol-configurable state-and-event
abstraction.

`Keepalive` receives three explicit inputs:

- `handleIdle()` from an `IdleWatchdog.onIdle` subscription;
- `probeNow()` from a wake/visibility monitor, a diagnostic action, or any other consumer that needs
  an immediate liveness check;
- `receive(message)` for validated incoming protocol packets.

It publishes a single typed event stream:

- `send` asks a subscriber to write a configured ping or pong packet;
- `timeout` reports that an earlier ping had no matching pong by its configured deadline;
- `error` reports a throwing scheduler or protocol adapter and makes the instance terminal.

The package owns one response-deadline timer for its pending ping. It does not own the quiet-period
timer that decides when the first probe is needed. `RealtimeClient` wires the watchdog to
`handleIdle()`, subscribes to keepalive events, performs requested transport writes, and owns every
watchdog reset. `probeNow()` starts the ping path synchronously; it does not schedule a zero-delay
timer.

`Keepalive` has no dependency on `IdleWatchdog`. Idle-driven composition is one use case, not a
package relationship: another consumer may drive keepalive from a fixed scheduler, a manual command,
or only `probeNow()`.

## Contract

The protocol adapter owns packet shape and correlation. Keepalive treats both as opaque values.

```ts
type Unsubscribe = () => void;

type KeepaliveScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;

type KeepaliveProtocol<TIncoming, TOutgoing, TCorrelation> = Readonly<{
  createPing: () => Readonly<{
    message: TOutgoing;
    correlation: TCorrelation;
  }>;
  isPong: (message: TIncoming, correlation: TCorrelation) => boolean;
  createPong?: (
    message: TIncoming,
  ) => Readonly<{ message: TOutgoing }> | null;
}>;

type KeepaliveEvent<TOutgoing, TCorrelation> =
  | Readonly<{
      type: 'send';
      kind: 'ping' | 'pong';
      message: TOutgoing;
    }>
  | Readonly<{
      type: 'timeout';
      correlation: TCorrelation;
    }>
  | Readonly<{ type: 'error'; error: unknown }>;

type KeepaliveLogger = Readonly<{
  error: (message: string, metadata?: unknown) => void;
}>;

type KeepaliveOptions<TIncoming, TOutgoing, TCorrelation> = Readonly<{
  deadlineMs: number;
  protocol: KeepaliveProtocol<TIncoming, TOutgoing, TCorrelation>;
  scheduler?: KeepaliveScheduler;
  logger?: KeepaliveLogger;
}>;

class Keepalive<TIncoming, TOutgoing, TCorrelation> {
  constructor(
    options: KeepaliveOptions<TIncoming, TOutgoing, TCorrelation>,
  );

  handleIdle(): void;
  probeNow(): void;
  receive(message: TIncoming): boolean;
  subscribe(
    listener: (event: KeepaliveEvent<TOutgoing, TCorrelation>) => void,
  ): Unsubscribe;

  stop(): void;
  [Symbol.dispose](): void;
}
```

Example protocol configuration for the realtime v1 JSON packets:

```ts
const protocol: KeepaliveProtocol<ServerPacket, ClientPacket, string> = {
  createPing: () => {
    const id = createRequestId();
    return { message: { type: 'ping', id }, correlation: id };
  },
  isPong: (packet, id) => packet.type === 'pong' && packet.id === id,
  createPong: (packet) =>
    packet.type === 'ping'
      ? { message: { type: 'pong', id: packet.id } }
      : null,
};
```

`createPing()` returns correlation separately from the wire packet, so keepalive never guesses an
`id` field or assumes JSON. `createPong()` is optional for protocols in which this endpoint never
answers peer-initiated probes.

## State and behavioral rules

The internal state is deliberately limited to one pending correlation, one deadline handle and
generation, one synchronous transition guard, and terminal flags:

```text
quiet --handleIdle/probeNow-----------> creating-ping
creating-ping --store/arm/enter-------> awaiting-pong (then notify send/ping)
creating-ping --handleIdle/probeNow---> creating-ping (no-op)
awaiting-pong --matching pong/clear---> quiet
awaiting-pong --deadline/disarm-------> notifying-timeout
notifying-timeout --still active------> creating-ping (fresh round)
notifying-timeout --stop--------------> stopped
any active state --internal error-----> failed
any state --stop----------------------> stopped
```

- on the first idle signal, `createPing()` runs once; keepalive stores its correlation, arms the
  response deadline, enters `awaiting-pong`, and then publishes the `send/ping` event. A synchronous
  matching pong from a send subscriber can therefore complete the round correctly;
- the synchronous transition guard is set **before** invoking configurable `createPing()` and remains
  set through `send/ping` notification. Re-entrant `handleIdle()` or `probeNow()` calls from the
  adapter or a subscriber therefore coalesce into the in-progress request;
- `probeNow()` follows the same start path immediately when quiet; it does not wait for the idle
  watchdog or implement immediacy as a zero-delay timer;
- `handleIdle()` and `probeNow()` are idempotent while awaiting a pong. They preserve the outstanding
  correlation and publish no second ping, because replacing it would turn a valid pong already in
  flight into stale evidence;
- keepalive arms the deadline before publishing `send/ping`, so even a missing or inert send
  subscriber cannot leave an unbounded pending round. Keepalive does not assume the packet was
  accepted; the subscriber still owns the write result and resource-failure policy;
- while a probe is pending, only `isPong(message, correlation) === true` completes it. A match clears
  the timer and pending correlation before `receive()` returns;
- `receive()` returns `true` only for a matching pong or a peer ping handled by `createPong()`; control
  packets consumed by keepalive are not delivered as application messages;
- unrelated traffic is not consumed, does not clear the pending correlation, and does not move its
  response deadline. A composing `RealtimeClient` may still reset `IdleWatchdog` for that traffic,
  but the watchdog controls only when a quiet connection first needs a probe;
- when the response deadline expires, keepalive first disarms and invalidates that timer, removes the
  expired correlation from pending state, and publishes one `timeout` event containing the expired
  correlation;
- timeout subscribers run before any continuation. After the notification snapshot finishes,
  keepalive starts one fresh correlated round synchronously if it is still active. A subscriber can
  call `stop()` to prevent that next ping;
- a subscriber that needs asynchronous recovery must call `stop()` before its first `await`; promises
  returned by listeners are not awaited and do not postpone continuation;
- `handleIdle()` and `probeNow()` re-entered during timeout notification coalesce into that automatic
  next round rather than starting an extra one;
- each unanswered round therefore produces at most one timeout and, while not stopped, one subsequent
  ping with a new correlation. There is never more than one deadline handle or pending correlation;
- `createPong()` is evaluated only after the packet fails to match the pending pong, then a non-null
  result publishes `send/pong` without changing the pending round or its deadline;
- subscribers run in registration order over a snapshot; one throwing subscriber is logged and does
  not block later subscribers or the post-timeout continuation check;
- all public inputs and notifications are synchronous and contain no `await`, so separate event-loop
  calls are serialized. The transition guard covers the only same-stack concurrency: re-entrancy;
- `stop()` is terminal and idempotent, clears and invalidates the deadline timer, pending correlation,
  and subscribers, and makes later inputs inert.

There is no probe queue. Multiple immediate checks represent the same liveness question, so they are
coalesced into one outstanding probe. Queueing would send redundant probes after the first answer and
would require expiry/cancellation semantics without adding evidence.

If the scheduler or `createPing`, `isPong`, or `createPong` throws, keepalive clears its timer and
pending state, publishes one `error` event, logs the failure without packet contents, and becomes
terminal. `RealtimeClient` treats that as a protocol configuration failure for the attempt. The
keepalive package itself still performs no external resource action.

## Ownership and realtime composition

`RealtimeClient` owns all wiring and effects:

```text
valid/accepted traffic ───────────────┐
                                      ↓ reset()
Transport ← send request ← RealtimeClient → IdleWatchdog
     │                         ↑              │
     │ incoming packet         │              │ onIdle
     └─────────────────────────┤              ↓
                               └──────── Keepalive ── response deadline
                                  ↑ probeNow                │
                         wake / visibility / manual check   └─ timeout
                                   send / timeout / error events
```

For each ready transport attempt, `RealtimeClient`:

1. creates a fresh watchdog and keepalive;
2. wires `watchdog.onIdle(() => keepalive.handleIdle())`;
3. subscribes to keepalive events;
4. arms the watchdog by calling `reset()` on ready entry;
5. resets it after each valid incoming packet and accepted outgoing packet;
6. passes incoming control packets to `keepalive.receive()`;
7. writes `send` events through the same generation-guarded internal packet path;
8. exposes `probeNow()` as a guarded delegation while the attempt is ready;
9. synchronously stops keepalive and retires the attempt on `timeout`, rejected keepalive writes, or
   `error`, so that realtime policy prevents the next automatic round;
10. disposes both instances before closing the transport so late callbacks are inert.

This preserves the higher-level ownership rule: keepalive detects a failed probe, but only
`RealtimeClient` can decide that the current attempt should enter backoff. Neither keepalive nor the
watchdog can close or replace a transport.

The observer pattern is intentionally narrow here. There is one event union and unsubscribe-returning
listeners, not a general event bus, notifier hierarchy, or RxJS dependency.

## Timing and continuation semantics

`IdleWatchdog.idleMs` and `Keepalive.deadlineMs` have different meanings and different owners:

```text
last accepted traffic ── idleMs ──> ping ── deadlineMs ──> timeout notification
                                      │                         │
                                      ├─ matching pong → quiet  ├─ stop() → stopped
                                      │                         └─ still active → fresh ping
                                      └─ unrelated traffic resets only the idle watchdog
```

A completely silent dead connection is first reported within approximately `idleMs + deadlineMs`,
plus platform scheduling delay. `probeNow()` skips `idleMs`: it starts the ping synchronously and the
same `deadlineMs` bounds the answer.

After a missed deadline, continuing with a new round is the smallest reusable behavior: it avoids a
retry counter, retry callback, or second public start method. Each round has a fresh correlation and
the same deadline. The timeout event is published before continuation, so an owner can synchronously
stop the keepalive when its policy is to retire a connection. If no owner stops it, an unresponsive
peer is probed at approximately `deadlineMs` intervals. A matching pong returns the instance to quiet;
successful rounds do not create a fixed ping interval and the next ordinary probe still requires
`handleIdle()` or `probeNow()`.

An unanswered-ping budget, backoff, jitter, and adaptive cadence are intentionally not configuration
in v1. They are lifecycle policy and can be added only when a concrete consumer needs behavior other
than "continue until stopped."

Browser timer throttling may delay the first idle signal. `net-monitor` still owns visibility,
online, and sleep/wake detection; on a ready connection it calls `RealtimeClient.probeNow()` rather
than waiting for the idle window. A confirmed network-generation change may still justify an
immediate `reconnect()` without probing.

## Scope

In v1:

- configurable ping creation and correlated pong matching;
- synchronous `probeNow()` for wake, foreground-return, diagnostics, or manual checks;
- optional peer-ping to pong adaptation;
- one outstanding probe, one configurable response-deadline timer, and one timeout event per missed
  round;
- automatic fresh rounds after timeout until a subscriber stops the instance;
- a typed `send | timeout | error` subscription stream;
- listener and protocol-adapter failure isolation;
- no runtime dependencies.

Not in v1:

- idle scheduling, watchdog reset, transport access, serialization, logging packet bodies, close, or
  reconnect;
- fixed protocol fields, JSON assumptions, request-id generation policy, or authentication;
- multiple simultaneous probes, configurable retry budgets, retry backoff, jitter, adaptive
  intervals, latency metrics, or RTT histograms;
- server lease renewal, application acknowledgements, RPC correlation, or message delivery retry;
- a generic event bus or observable library.

## Validation and testing

Construction fails fast when `deadlineMs` is non-finite or not greater than zero. The protocol
callbacks are required functions except optional `createPong`; TypeScript provides the shape
contract. Runtime construction may validate callable fields for JavaScript consumers without
inspecting returned packets.

Required public-behavior tests:

- first idle stores correlation, arms one deadline, and publishes one configured ping in that order;
- `probeNow()` publishes the same configured ping immediately when quiet;
- repeated `probeNow()` while awaiting a pong emits nothing and preserves the original correlation;
- back-to-back `probeNow()` calls publish once;
- `probeNow()` or `handleIdle()` re-entered from `createPing()` or a `send/ping` subscriber publishes
  once and does not recurse;
- simultaneous `handleIdle()` and `probeNow()` requests coalesce into one pending probe;
- matching pong is consumed, clears the deadline, and the next idle starts a fresh probe;
- wrong or late pong is not consumed and does not clear the current probe;
- unrelated traffic and repeated idle events do not move the pending ping deadline;
- deadline expiry clears the old round and publishes one timeout with its correlation before sending
  a new ping with a new correlation;
- `stop()` from a timeout subscriber prevents the automatic next round;
- repeated unanswered rounds use exactly one timer and one pending correlation at a time;
- a stale queued deadline callback after pong, replacement, or stop is ignored;
- peer ping publishes the configured pong and is consumed;
- ordinary packets are not consumed;
- subscriber order, unsubscribe, re-entrant subscription changes, and failure isolation;
- each throwing scheduler or protocol callback publishes one error and makes later inputs inert;
- `stop()` clears the deadline, state, and listeners and is idempotent;
- invalid `deadlineMs` values fail construction.

Realtime integration tests must additionally prove:

- keepalive subscribes to the watchdog through `RealtimeClient` wiring;
- neither keepalive nor watchdog calls `reset()`;
- accepted ping/pong writes and valid incoming traffic are reset by `RealtimeClient`;
- watchdog resets do not move keepalive's pending response deadline;
- ready `RealtimeClient.probeNow()` delegates immediately, while non-ready or disabled calls are
  inert;
- rejected control writes and timeout events retire only the current transport generation;
- old attempt callbacks cannot send on or retire a newer connection.

## Alternatives considered

**Let keepalive own the idle cadence as well as the pong deadline.** Rejected. `IdleWatchdog` already
owns the general inactivity question and can serve consumers unrelated to ping/pong. Keepalive owns
only the deadline created by a ping it has issued.

**Implement immediate probing as `setTimeout(..., 0)` or `watchdog.reset(0)`.** Rejected. A direct
`probeNow()` input is simpler, deterministic, and does not overload the watchdog's meaning of
"activity happened". It also avoids a queued zero-delay callback racing with traffic or disposal.

**Queue simultaneous probe requests.** Rejected. They ask the same yes/no liveness question. A
synchronous in-progress guard plus one pending correlation coalesces them without ordering, expiry,
or cancellation policy.

**Require a subscriber to call `probeNow()` after every timeout.** Rejected. Continuing automatically
is a smaller steady-state contract and avoids an external rescheduling loop. Notifying first and
honoring synchronous `stop()` still leaves lifecycle policy outside keepalive.

**Add Ringotel's random verification interval and unanswered-ping budget.** Deferred. A distinct
response deadline is retained because it directly bounds each probe. Random cadence and a retry
budget add policy that the reusable v1 does not need; it continues until an owner stops it.

**Inject the transport and close callback into keepalive.** Rejected. It would let a protocol helper
act on a stale attempt and duplicate `RealtimeClient` lifecycle ownership.

**Let keepalive reset the watchdog after sending or receiving.** Rejected. Keepalive does not know
whether the transport accepted a write or whether an incoming packet passed the realtime protocol
boundary. `RealtimeClient` has the authoritative evidence.

**Treat any incoming packet as the pong or move its deadline.** Rejected. Other traffic may postpone
the next idle-triggered probe, but only the configured matching response completes this pending one.

**Hard-code `{ type: 'ping' | 'pong', id }`.** Rejected. Shape adaptation is the reusable seam and
keeps this package independent of the realtime JSON protocol.

## Consequences

Positive:

- keepalive has deterministic protocol state and one injectable deadline timer, with no transport
  dependency;
- callers can probe immediately without coupling keepalive to a wake monitor;
- ping/pong wire shape remains a caller configuration;
- `RealtimeClient` remains the only transport-attempt and reset owner;
- the same component can support JSON, SIP, or another message shape;
- one correlated probe avoids false success from unrelated packets;
- same-stack re-entrancy and back-to-back calls cannot create duplicate probes;
- timeout-before-continuation ordering lets an owner stop without racing a fresh ping.

Tradeoffs:

- composition requires two subscriptions and explicit write/reset handling in `RealtimeClient`;
- first failure detection takes `idleMs + deadlineMs` for an idle-driven probe and depends on platform
  timer scheduling;
- an immediate probe still waits one configured `deadlineMs` for its pong verdict;
- if no subscriber stops it, a failed peer causes one timeout and one new ping per deadline window;
- asynchronous timeout handlers must stop synchronously before awaiting if they need to suppress the
  next round;
- attempt-local construction is preferred over a reusable `reset()` method, creating a small object
  per ready transport generation.

## Next steps

1. Accept this ADR together with `IdleWatchdog.md` and the revised `Realtime.md`.
2. Scaffold `packages/keepalive/` and implement it from the public-behavior tests above.
3. Add a changeset for `@bazariodev/keepalive` at `0.1.0`.
4. Add the realtime v1 JSON protocol adapter and generation-guarded integration tests.
5. Validate idle-driven and immediate wake probes, deadline expiry, and stop-before-continuation in
   the R2 demo before adding retry budgets or adaptive cadence.

## Summary

`@bazariodev/keepalive` turns idle signals, immediate probe requests, and incoming packets into typed
ping, pong, timeout, and error events. Packet shape and correlation are configured; transport writes,
watchdog resets, closing, and reconnecting stay in `RealtimeClient`. `probeNow()` sends immediately
when quiet, coalesces re-entrant or simultaneous requests, and preserves an existing pending probe. A
first idle sends one probe; a matching pong clears its configurable deadline. A missed deadline emits
the expired correlation and starts a fresh round only after subscribers have had the chance to stop
the instance.
