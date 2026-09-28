# ADR: Keepalive Liveness Orchestrator

- Status: Accepted
- Date: 2026-09-13
- Revised: 2026-09-27

## Context

A connection can appear open after its peer becomes unreachable. A liveness monitor needs an idle
window, a fresh check, and a bounded wait. Packet construction, correlation, response matching, and
validation are already responsibilities of a request/protocol handler. Repeating them in Keepalive
couples scheduling to the wire exchange and adds a second request/response implementation.

## Decision

Implement `@bazariodev/keepalive` as an attempt-local orchestrator over two `IdleWatchdog` instances:
one for `idleMs`, one for `deadlineMs`. Inject `probe(signal): Promise<void>` as the complete liveness
check. Keepalive invokes it, observes settlement, and aborts on terminal failure or disposal.

The parent reports validated incoming traffic and handles failure recovery. The request/protocol handler owns
packet shapes, unique correlation, response validation, send errors, and peer-ping replies. Keepalive
and its parent coordinate through promise settlement; the parent delegates protocol work to the handler.

This supersedes the packet-facing `protocol`, `send`, and `receive` contract and its packet/correlation
generics. Autonomous idle scheduling remains; Keepalive has no transport or reconnect dependency.

## Public contract

```ts
type KeepaliveProbe = (signal: AbortSignal) => Promise<void>;
type KeepaliveFailure =
  | Readonly<{ type: 'timeout' }>
  | Readonly<{ type: 'error'; error: unknown }>;

type KeepaliveOptions = Readonly<{
  idleMs: number;
  deadlineMs: number;
  probe: KeepaliveProbe;
  scheduler?: KeepaliveScheduler; // IdleWatchdog's TimeoutScheduler.
  logger?: KeepaliveLogger;       // Non-throwing error(message, metadata?) port.
}>;

class Keepalive {
  constructor(options: KeepaliveOptions);
  start(): void;
  activity(): void;
  probeNow(): void;
  onFail(listener: (failure: KeepaliveFailure) => void): () => void;
  stop(): void;
  [Symbol.dispose](): void;
}
```

The canonical declarations are in `packages/keepalive/src/index.d.ts`. The callback starts a fresh
operation on every invocation. Fulfillment means that the consumer has validated liveness of the
current connection. Rejection or synchronous throw means failure, with the original cause preserved.
A `Promise<void>` carries no protocol data or boolean verdict across this boundary.

Local write admission, a cache hit, a request over a different transport, or success after reconnect
cannot establish this connection's liveness. The probe must not retry across attempts. The consumer
must register its response matcher before sending so an immediate response is not lost.

## Lifecycle and timing

```text
constructed --start--------------------> monitoring-idle
monitoring-idle --activity-------------> monitoring-idle (fresh idle window)
monitoring-idle --idle/probeNow--------> awaiting-promise
awaiting-promise --fulfillment---------> monitoring-idle (fresh idle window)
awaiting-promise --activity/probeNow---> awaiting-promise (unchanged)
awaiting-promise --deadline-----------> failed
active --rejection/throw/error--------> failed
any --stop----------------------------> stopped
```

- Construction is inert. Subscribe before start. Activity and probes are inert before start and after
  termination. `start()` is idempotent and never moves an existing idle window.
- Before invoking consumer code, store a fresh AbortController, suspend idle monitoring, and arm the
  deadline. Pending identity also coalesces repeated and re-entrant probes without a queue.
- Attach fulfillment and rejection handlers even if the callback synchronously stops the monitor
  before returning. No late rejection is left unhandled by Keepalive.
- Only the deadline watchdog runs while a probe is pending. Ordinary traffic cannot extend it.
- Fulfillment observed by the promise reaction cancels the deadline, clears pending state, and
  starts a fresh idle window. Already fulfilled promises still use asynchronous reactions.
- Probe rejection, synchronous throw, or timeout is terminal. Invalidate the
  pending identity, stop both watchdogs, and abort before notifying subscribers. No next probe runs.
- `stop()` and disposal are silent, terminal, and idempotent. Late settlement and queued timer callbacks
  cannot revive an instance. Create a fresh monitor for a new connection attempt.

`idleMs` determines when to ask about liveness; `deadlineMs` bounds the asynchronous wait for its
answer. A quiet dead connection is detected after approximately their sum, plus scheduling delay.
`probeNow()` skips the idle wait. There is no fixed interval or unanswered-probe retry loop.

Only validated incoming traffic from the monitored connection counts as activity. Local write
admission is not evidence of peer reachability and must not postpone probes. A send-heavy connection
with no incoming packets still gets checked after `idleMs`. During a probe, even validated inbound
traffic leaves its deadline unchanged; only that probe's fulfillment completes the check.

## Cancellation and deadline ownership

Keepalive owns this probe's deadline. The request handler uses the supplied AbortSignal instead of a
second request timeout for the same check. Other application requests can have independent timeouts.

The consumer checks an already-aborted signal, removes matchers/listeners on settlement or abort,
rejects pending work when aborted, and prevents delayed writes after cancellation. Cancellation is
cooperative: Keepalive can invalidate its own result even if the handler ignores the signal, but
cannot remove that handler's resources or recall a transmitted request. The handler must not close
a shared transport. Abort uses the platform's default abort reason; failure classification is
provided by `onFail`, not inferred from the aborted promise.

Timers do not interrupt synchronous JavaScript and may be delayed by blocking, throttling, or sleep.
This is a scheduled deadline, not a hard real-time guarantee. Network/wake detection belongs to
`net-monitor`, which can ask the parent for an immediate probe or reconnect.

## Ownership and integration

```text
RealtimeClient (readiness, attempt generation, traffic, transport, reconnect)
    ├─ Transport
    ├─ Internal protocol handler (always present while ready)
    │     └─ ping/pong matching, peer replies, abort cleanup
    └─ Keepalive (enabled by default; optional custom probe)
          ├─ IdleWatchdog(idleMs)
          ├─ IdleWatchdog(deadlineMs)
          └─ probe(signal) → internal handler by default
                              └─ matching + validation → fulfill/reject
```

For each ready attempt the planned RealtimeClient:

1. creates an internal protocol handler with this attempt's guarded writer, then one Keepalive
   unless client probing is explicitly disabled;
2. subscribes to `onFail`, retiring only the current attempt;
3. calls `start()` after readiness and subscription setup;
4. calls `activity()` only for validated inbound traffic; outgoing writes never refresh idleness;
5. routes protocol/application messages to their owners; Keepalive receives no packets;
6. delegates ready-state `probeNow()` for wake/manual checks;
7. invalidates the attempt, stops Keepalive to abort its pending probe, and disposes the handler
   before replacing or closing transport.

Realtime supplies the default probe through its internal ping/pong handler. An optional custom
`keepalive.probe` replaces only the client-initiated check; `keepalive: false` disables those checks.
The handler exists in both cases: it always consumes ping/pong control packets before application
message delivery and answers server pings while ready. A server-reply write failure reaches the
client's guarded retirement path even when no Keepalive exists.

The handler is private to the realtime package, with no public export or separate package until a
second consumer needs it. The planned `rpc` package stays above realtime; no realtime-to-RPC import
is needed for default liveness. Custom consumers can supply their own abort-aware request adapter.
Realtime retains protocol validation and attempt ownership; Keepalive remains protocol-neutral.

Generation guards prevent failure or old request callbacks from affecting a new attempt. The request
handler must bind each operation to the initiating connection and avoid retry/replay after replacement.
The first keepalive failure and a later transport close share one guarded recovery path.

## Validation, failures, and subscriptions

Both durations must be integer milliseconds in `[1, 2_147_483_647]`. Each watchdog validates its own
value; Keepalive forwards it unchanged and propagates RangeError without duplicate checks.
Public types require the probe; runtime construction does not duplicate function-shape validation.
A missing/non-callable probe or a result without callable `then` becomes a terminal `error` failure
with the original TypeError when the check runs. No constructor shape check is added. Returning no
promise is neither treated as success nor left waiting for a misleading timeout. An async callback
must still await request completion and validation: a valid promise alone cannot prove that it did.

The scheduler serves both windows, with opaque timer handles. Its methods must not throw, invoke
callbacks inline, or re-enter Keepalive. Keepalive relies on this contract; behavior with a violating
scheduler is unsupported. It does not add a separate scheduler-error recovery policy.

Failure listeners run synchronously in registration order over a snapshot captured before abort.
Duplicate functions share one subscription; stale unsubscribe handles cannot remove a later
registration. Unsubscribe or stop during abort/notification cannot cancel an already committed
failure's delivery. This lets the owner retire its attempt without hiding the failure from observers.
Explicit stop before failure remains silent. Late subscriptions are inert; failures are not replayed.
Synchronous listener exceptions are isolated and passed to the consumer's logger as the original
error. Listener promises are not awaited. Operation failures reach `onFail` without duplicate logging.
The optional logger defaults to a no-op and must not throw; consumers supply it for diagnostics.

## Scope and alternatives

In v1: autonomous idle scheduling, immediate probes, one pending promise, bounded waiting, cooperative
cancellation, terminal failure subscriptions, injected scheduler/logger, and disposal. The only
runtime dependency is `@bazariodev/idle-watchdog`; runtime is plain JavaScript with ESM/CJS builds and
public `.d.ts`/`.d.cts` declarations.

Outside v1: packet construction/matching/validation, peer replies, transport, reconnect, request
retry, application delivery guarantees, adaptive cadence, jitter, and RTT metrics.

**Packet-aware Keepalive.** Superseded. Request handlers already own correlation and validation.
An injected promise keeps that responsibility in one place and works with different protocols.

**Pre-created promise.** Rejected. Every check must start a fresh operation under a fresh deadline.

**Only Promise.race.** Insufficient. Choosing a timeout result does not clean up pending request
resources. The handler also needs an AbortSignal, and stale settlement must be ignored.

**External idle orchestration.** Not selected. Keepalive retains the agreed autonomous scheduling;
consumers report activity and request immediate probes without coordinating timers themselves.

**Continue after failure.** Rejected. Recovery belongs to the parent; a failed monitor is terminal.

## Verification and next steps

Public-behavior tests cover idle/activity timing, immediate and re-entrant probes, fresh signals,
fulfillment/rejection/throw, timeout and abort cleanup, late settlement, stale timer callbacks,
silent disposal, complete failure delivery through owner cleanup, duration-validation delegation,
and browser/Worker public types.
Exhaustive timer bounds and handles remain tested in idle-watchdog.

Future realtime integration must prove ready-only startup, generation-bound request handling,
inbound-activity reporting, one recovery decision, and cancellation before transport replacement.
Those client/request-handler implementations are planned, not supplied by this package.
