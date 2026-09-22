# ADR: Idle Watchdog Module

- Status: Proposed
- Date: 2026-09-13
- Revised: 2026-09-14

## Context

Several future packages need to know that a resource has been inactive for a configured period. A
realtime client can use this to probe a quiet socket, but the same mechanism is useful for SIP
registrations, media sessions, presence leases, and other activity-driven lifecycles.

The reusable concern is only timing:

1. a consumer reports activity;
2. the inactivity deadline moves;
3. if no later activity arrives before the deadline, subscribers receive one idle notification.

The watchdog cannot decide what activity means. For a realtime connection that decision belongs to
`RealtimeClient`, which sees validated incoming frames and accepted outgoing writes. The watchdog
also cannot decide whether idleness should send a ping, refresh a lease, log a diagnostic, close a
transport, or reconnect. Those are consumer policies.

The public name is **`IdleWatchdog`** and the event is **`onIdle`**. The misspelling `IddleWatchdog`
or `onIddle` is not exposed as an alias.

## Decision

Build **`@bazariodev/idle-watchdog`** as a small, dependency-free timer abstraction with one event.

- `reset()` is the only operation that starts or moves the inactivity timer;
- `cancel()` disarms it without making the instance terminal;
- `onIdle(listener)` registers a subscriber and returns its unsubscribe function;
- an elapsed timer disarms before notifying subscribers and emits exactly once until the next
  `reset()`;
- `stop()` / `[Symbol.dispose]()` permanently disarms the timer and clears subscribers.

The watchdog owns its timer mechanics and subscriber registry. It does **not** observe a socket,
classify traffic, reset itself after activity, send a message, close a resource, or reconnect
anything.

Calling it "side-effect free" means it has no effects on consumer resources. A timer and listener
notification are necessarily internal effects; they are bounded, injectable, and are the entire
purpose of this module.

## Contract

Illustrative types; exact internal names may change without changing the decision.

```ts
type Unsubscribe = () => void;

type TimeoutScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;

type IdleWatchdogLogger = Readonly<{
  error: (message: string, metadata?: unknown) => void;
}>;

type IdleWatchdogOptions = Readonly<{
  idleMs: number;
  scheduler?: TimeoutScheduler;
  logger?: IdleWatchdogLogger;
}>;

class IdleWatchdog {
  constructor(options: IdleWatchdogOptions);

  reset(): void;
  cancel(): void;
  onIdle(listener: () => void): Unsubscribe;

  stop(): void;
  [Symbol.dispose](): void;
}
```

There is no `start()` method. `reset()` means "activity happened now" and is sufficient for both the
initial arm and every later re-arm. This avoids separate start/reset states that can disagree.

## Behavioral rules

- construction is inert; no timer is armed until the first `reset()`;
- `idleMs` is fixed for an instance and must be finite and greater than zero;
- `reset()` clears the current handle, invalidates its callback generation, and arms one new timeout;
- a callback from a cleared or superseded timer is ignored even if the platform had already queued it;
- the active callback disarms the watchdog before notifying a snapshot of the current subscribers;
- an idle notification is one-shot: time passing again does nothing until a consumer calls `reset()`;
- `cancel()` is idempotent and restartable; a later `reset()` arms the same instance again;
- `stop()` is terminal and idempotent; later `reset()`, `cancel()`, and subscriptions are inert;
- subscribers run in registration order; one throwing subscriber is logged and does not block later
  subscribers;
- subscribing the same function twice is idempotent because listeners are stored in a `Set`;
- unsubscribe functions are idempotent.

The scheduler defaults to platform `setTimeout` / `clearTimeout`. Tests inject a manual scheduler;
the package does not depend on `@bazariodev/fsm-delays` because there is no FSM or state-entry
lifecycle to compose with.

## Ownership and realtime composition

`RealtimeClient` owns the definition of socket activity and therefore owns every watchdog reset.
The selected v1 policy is:

- entering `ready` calls `watchdog.reset()` to start observation for that transport attempt;
- every valid incoming control or application packet calls `watchdog.reset()`;
- every outgoing control or application packet accepted by `transport.send()` calls
  `watchdog.reset()`;
- rejected writes and malformed packets do not extend the deadline;
- leaving `ready` cancels and disposes the attempt-local watchdog.

This is an **idle-connection** policy, not proof that every write reached the peer. Frequent traffic
in either direction intentionally postpones keepalive probes. A later product that needs
inbound-only liveness can choose a narrower reset policy without changing `IdleWatchdog`.

The watchdog never receives a transport or realtime client reference:

```text
accepted inbound/outbound traffic
              ↓
       RealtimeClient ──reset()──> IdleWatchdog
              ↑                         │
              └──── onIdle subscriber ──┘
```

For keepalive composition, `RealtimeClient` wires the idle event to `Keepalive.handleIdle()`. The
watchdog does not import or construct keepalive, and keepalive does not reset the watchdog. These are
two independent reusable abstractions: `IdleWatchdog` may notify unrelated consumers, while
`Keepalive` may be driven by another idle source or by its immediate `probeNow()` input. Once a ping
has started, keepalive's own response deadline decides whether its matching pong arrived; later
watchdog resets do not move that per-ping deadline.

## Scope

In v1:

- one re-armable inactivity timeout;
- one `onIdle` event with unsubscribe-returning listeners;
- restartable cancellation and terminal disposal;
- injected timeout scheduler and optional logger;
- stale-callback protection and subscriber failure isolation.

Not in v1:

- intervals, cron, pause/resume, persisted deadlines, or background-worker scheduling;
- dynamic per-reset durations, warning thresholds, retry budgets, or multiple idle stages;
- resource inspection, traffic classification, ping/pong, close, reconnect, or recovery policy;
- keepalive imports or knowledge; consumers compose the two abstractions structurally;
- FSM state, snapshots, React bindings, or a generic event-emitter framework.

## Validation and testing

Construction fails fast when `idleMs` is non-finite or not greater than zero. The scheduler and
logger are typed injections and follow the same trust boundary as the existing FSM modules.

Required public-behavior tests:

- construction is inert and the first `reset()` arms exactly one timeout;
- repeated `reset()` replaces the timeout and only the latest callback can emit;
- expiry emits once and remains disarmed until another `reset()`;
- `cancel()` prevents emission and a later `reset()` works;
- a stale queued callback after reset/cancel is ignored;
- listeners run in registration order and unsubscribe is idempotent;
- a throwing listener does not block later listeners;
- `reset()` called by an idle subscriber safely arms the next window;
- `stop()` clears the timer/listeners and makes later calls inert;
- invalid `idleMs` values fail construction.

The realtime integration test must separately prove that `RealtimeClient`, rather than the watchdog
or keepalive, performs resets for ready entry and accepted traffic.

## Alternatives considered

**Let the watchdog subscribe to transport traffic.** Rejected. It would couple a generic timer to a
transport contract and make traffic classification ownership ambiguous.

**Reset automatically after notifying `onIdle`.** Rejected. It creates an implicit interval and can
emit repeated idle events without new activity. The consumer must explicitly report new activity.

**Pass an action such as `close` or `reconnect` into the watchdog.** Rejected. Different consumers
need different reactions, and a timer should not own resource lifecycle policy.

**Implement it as an FSM delay.** Rejected for v1. The abstraction has only armed/disarmed timer
bookkeeping and no useful public state machine. Depending on FSM packages would make the primitive
larger without improving its contract.

## Consequences

Positive:

- traffic ownership stays with the component that actually sees and validates traffic;
- any number of consumers can react to idleness without being coupled to one action;
- one-shot behavior prevents surprise repeated actions;
- timer behavior is deterministic in tests and reusable outside realtime.

Tradeoffs:

- consumers must remember to reset and cancel at their own lifecycle boundaries;
- platform timer throttling can delay notification; the watchdog detects inactivity when its callback
  can run, while `net-monitor` remains responsible for immediate wake recovery;
- a separate package adds a small composition seam that must be wired correctly.

## Next steps

1. Accept this ADR together with `Keepalive.md` and the revised `Realtime.md`.
2. Scaffold `packages/idle-watchdog/` with the contract and manual-scheduler tests above.
3. Add a changeset for `@bazariodev/idle-watchdog` at `0.1.0`.
4. Compose one attempt-local instance inside `RealtimeClient` and test reset ownership end to end.

## Summary

`@bazariodev/idle-watchdog` is a one-shot, re-armable inactivity timer. Consumers explicitly call
`reset()` when activity occurs and subscribe through `onIdle`; the watchdog only owns timer mechanics
and notification. In realtime, `RealtimeClient` alone classifies traffic, resets the timer, and
decides what an idle or failed connection means.
