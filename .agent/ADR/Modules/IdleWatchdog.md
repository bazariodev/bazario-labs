# ADR: Idle Watchdog Module

- Status: Accepted
- Date: 2026-09-13
- Revised: 2026-10-11

## Context

Several future packages need to know that a resource has been inactive for a configured period. A
realtime client can use this to probe a quiet socket, but the same mechanism is useful for SIP
registrations, media sessions, presence leases, and other activity-driven lifecycles.

The reusable concern is only timing:

1. a consumer reports activity;
2. the inactivity deadline moves;
3. if no later activity arrives before the deadline, subscribers receive one idle notification.

The watchdog cannot decide what activity means. For a realtime connection that decision belongs to
`Keepalive`, which subscribes to validated incoming packets. The watchdog
also cannot decide whether idleness should send a ping, refresh a lease, log a diagnostic, close a
transport, or reconnect. Those are consumer policies.

The public name is **`IdleWatchdog`** and the event is **`onIdle`**. The misspelling `IddleWatchdog`
or `onIddle` is not exposed as an alias.

## Decision

Build **`@bazariodev/idle-watchdog`** as a small, dependency-free timer abstraction with one event.

- `arm()` is the only operation that starts or moves the inactivity timer;
- `cancel()` disarms it without making the instance terminal;
- `onIdle(listener)` registers a subscriber and returns its unsubscribe function;
- an elapsed timer disarms before notifying subscribers and emits exactly once until the next
  `arm()`;
- `stop()` / `[Symbol.dispose]()` permanently disarms the timer and clears subscribers.

The watchdog owns its timer mechanics and subscriber registry. It does **not** observe a socket,
classify traffic, arm itself after activity, send a message, close a resource, or reconnect
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
  idleMs: number | (() => number);
  scheduler?: TimeoutScheduler;
  logger?: IdleWatchdogLogger;
}>;

class IdleWatchdog {
  constructor(options: IdleWatchdogOptions);

  arm(): void;
  cancel(): void;
  onIdle(listener: () => void): Unsubscribe;

  stop(): void;
  [Symbol.dispose](): void;
}
```

`arm()` starts a fresh inactivity window from now, replacing any pending window. It works before
the first timer, while a timer is pending, and after expiry or cancellation. There is no separate
`start()` method.

## Behavioral rules

- construction is inert; no timer is armed until the first `arm()`;
- `idleMs` is a fixed integer or a function drawing an integer from `1` through `2_147_483_647`
  milliseconds, inclusive. Functions run once per arm without a receiver; invalid values throw
  `RangeError` without clamping or rounding. A failed draw leaves no timer of its own;
- `arm()` clears the current handle, invalidates its callback generation, and arms one new timeout;
- a callback from a cleared or superseded timer is ignored even if the platform had already queued it;
- the active callback disarms the watchdog before notifying a snapshot of the current subscribers;
- an idle notification is one-shot: time passing again does nothing until a consumer calls `arm()`;
- `cancel()` is idempotent and restartable; a later `arm()` arms the same instance again;
- `stop()` is terminal and idempotent; later `arm()`, `cancel()`, and subscriptions are inert;
- subscribers run in registration order; one throwing subscriber is logged and does not block later
  subscribers;
- subscribing the same function twice shares one subscription; either unsubscribe can remove it;
- unsubscribe functions are idempotent and cannot remove a later registration of the same function;
  the listener registry gives each active subscription a unique identity, shared by duplicate
  registrations of the same function.

Subscription changes during notification affect the next subscriber snapshot. Terminal `stop()`
also suppresses remaining subscribers in the notification already in progress. Listener error
isolation covers synchronous exceptions; listeners handle their own asynchronous failures.

The scheduler defaults to platform `setTimeout` / `clearTimeout`. Tests inject a manual scheduler;
the package does not depend on `@bazariodev/fsm-delays` because there is no FSM or state-entry
lifecycle to compose with.

The same integer range is enforced with default and injected schedulers. It prevents platform
overflow and implicit truncation while keeping a single portable package contract. Scheduling and
throttling can still delay callbacks. Consumers own any stricter resource or protocol limits.
Injected schedulers use asynchronous callbacks and non-throwing methods; the optional logger must
not throw.

## Ownership and realtime composition

`Keepalive` subscribes to the ready channel for validated incoming packets. Outgoing writes do not prove
peer reachability and do not refresh its idle window. Keepalive owns both watchdogs:

```text
Ready channel --validated packets--> Keepalive <--probeNow-- RealtimeClient
                                       ├─ IdleWatchdog(idleMs)
                                       └─ IdleWatchdog(deadlineMs)
```

The watchdog itself has no keepalive, transport, or realtime dependency. Keepalive uses its public
`arm`, `cancel`, `onIdle`, and `stop` methods. Other consumers can define different activity policies
for unrelated resource timers. The complete connection-monitoring policy lives in
[Keepalive](Keepalive.md#lifecycle-and-timing); parent composition lives in [Realtime](Realtime.md).

## Scope

In v1:

- one re-armable inactivity timeout;
- one `onIdle` event with unsubscribe-returning listeners;
- restartable cancellation and terminal disposal;
- injected timeout scheduler and optional logger;
- stale-callback protection and subscriber failure isolation.

Not in v1:

- intervals, cron, pause/resume, persisted deadlines, or background-worker scheduling;
- warning thresholds, retry budgets, or multiple idle stages;
- resource inspection, traffic classification, ping/pong, close, reconnect, or recovery policy;
- keepalive imports or knowledge; dependency direction is keepalive to watchdog;
- FSM state, snapshots, React bindings, or a generic event-emitter framework.

## Validation and testing

Construction validates fixed `idleMs` values as integers in `[1, 2_147_483_647]`. Duration
functions are validated when armed, before scheduling; this rejects fractions, non-finite numbers,
and values outside the range. A source that cancels or stops during its draw cannot re-arm it.
Coordination's `createJitter` is an optional injected duration source; the watchdog has no dependency
on that package and no knowledge of random policy.
The scheduler and logger are typed injections and follow the same trust boundary as the existing
FSM modules.

Required public-behavior tests:

- construction is inert and the first `arm()` arms exactly one timeout;
- repeated `arm()` replaces the timeout and only the latest callback can emit;
- expiry emits once and remains disarmed until another `arm()`;
- `cancel()` prevents emission and a later `arm()` works;
- a stale queued callback after arm/cancel is ignored;
- listeners run in registration order and unsubscribe is idempotent;
- stale unsubscribes from duplicate registrations cannot remove a newer registration;
- a throwing listener does not block later listeners;
- `arm()` called by an idle subscriber safely arms the next window;
- `stop()` clears the timer/listeners and makes later calls inert;
- invalid `idleMs` values fail construction with either scheduler;
- both inclusive timing bounds are preserved with platform and injected schedulers.

The realtime integration test must prove that the channel passes only validated incoming traffic
to Keepalive and that RealtimeClient disposes Keepalive with the attempt. Keepalive's tests prove ownership of
both watchdogs and that activity cannot extend a pending probe deadline.

## Alternatives considered

**Let the watchdog subscribe to transport traffic.** Rejected. It would couple a generic timer to a
transport contract and make traffic classification ownership ambiguous.

**Re-arm automatically after notifying `onIdle`.** Rejected. It creates an implicit interval and can
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

- consumers must remember to arm and cancel at their own lifecycle boundaries;
- platform timer throttling can delay notification; the watchdog detects inactivity when its callback
  can run, while `net-monitor` remains responsible for immediate wake recovery;
- a separate package adds a small composition seam that must be wired correctly.

## Next steps

Release the implemented duration-function support through the pending `0.2.0` changeset.

## Summary

`@bazariodev/idle-watchdog` is a one-shot, re-armable inactivity timer. Consumers explicitly call
`arm()` when activity occurs and subscribe through `onIdle`; the watchdog only owns timer mechanics
and notification. Keepalive owns ping/pong, inactivity, and response-window orchestration over
validated channel packets. `RealtimeClient` owns the connection lifecycle and recovery policy.
