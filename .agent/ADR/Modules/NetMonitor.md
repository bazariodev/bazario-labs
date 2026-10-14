# Net Monitor

- Status: Accepted
- Date: 2026-10-14

## Decision

Provide `@bazariodev/net-monitor` as a small, dependency-free source for browser online and offline
hints. It reads `navigator.onLine` and observes browser `online` and `offline` events. It reports
an error when the platform does not provide a boolean online value. It reports
`offline` immediately when a startup or later sample reads `navigator.onLine === false`.

The monitor attaches browser listeners only while it has subscribers. The first subscription
attaches both listeners and then reads current state. The last unsubscribe removes both listeners.
The caller owns the monitor and its lifetime. `stop()` is terminal and removes its listeners. Realtime
may subscribe to the source, but it does not stop the source or import this package. This keeps the
Realtime core usable when the package is absent.

The source reports observation only. It does not probe a server, handle visibility or wake events,
authenticate, or choose retry policy. Realtime owns connection suspension and recovery after it
receives the source state. Browser online state permits an attempt; it does not establish readiness.

The public source port and browser platform port use structural types. The declaration file does not
require DOM types, so the package can be used in Node and server-side rendering projects.

## Context

Add browser connectivity observation to Bazario Labs. Inject the source into the existing
`RealtimeClient`. The source reports browser state. The client owns the connection and all
recovery decisions.

This decision replaces the proposal for the older test-server checkout. Realtime is implemented.
Its states are `idle`, `connecting`, `ready`, `backoff`, and terminal `stopped`. Transport open
establishes ready. The client defines no authentication exchange or connect/ready wire protocol.
Use the accepted [composition decision](./RealtimeComposition.md).

## Package boundary

Provide `@bazariodev/net-monitor` with no runtime dependencies. Do not add it to
coordination. A later environment package can group related observers if actual
consumers need that package. Visibility, wake detection, active probes, polling,
React bindings, credentials, and message replay are outside this change.

The application creates the monitor and owns its lifetime. Realtime borrows the
source. A client releases its subscription on stop but does not stop the source.
Multiple clients can share one source. Transport owns one physical attempt.
Keepalive owns liveness checks. RPC owns its pending operations.

## Source contract

```ts
type ConnectivityState = 'online' | 'offline';

interface ConnectivitySource {
  getSnapshot(): ConnectivityState;
  subscribe(listener: (state: ConnectivityState) => void): () => void;
}
```

Realtime declares its own structural source port. It has no runtime, peer, or
public declaration import from net-monitor. The browser monitor satisfies this
port. Provide an optional `connectivity` option to the factory and injected core.
Use `createRealtimeClient({ createTransport, connectivity })` for default parts.
Direct construction still requires the lifecycle and event publisher.

`BrowserNetMonitor` reads `navigator.onLine` and browser online/offline events.
Use an injectable structural platform port. Public types must compile without
DOM types. A missing navigator, missing value, or non-boolean value throws a
`TypeError` when the monitor reads it. Accessor errors pass through unchanged.
A false value gives offline. Imports and construction attach no listeners. The
first subscriber attaches both listeners before reading the current state. The
last unsubscribe releases both. A new subscription reads state again after any
observation gap. A snapshot read without subscribers reads the platform state so
a previously observed value does not remain stale.

Each subscribe call owns an independent registration and cleanup function, even
for the same callback. Commit state before notification. Suppress duplicates.
Contain listener errors. Do not deliver to a removed registration. If notification
causes another state change, do not deliver an older state after the newer state.
Unsubscribe is idempotent. A failed sample removes only the new subscription. It
releases browser listeners when that subscription was the only one. It keeps
existing subscriptions active when a later subscription fails. `stop()` and
`[Symbol.dispose]()` are terminal and idempotent. Stop releases listeners and
subscriptions, retains the last snapshot, and makes later subscriptions inert.
Failed listener attachment releases any listener already attached before the
error is reported.

Realtime starts online before its first sample. It subscribes before sampling and
tolerates synchronous source callbacks. Its constructor cleans up subscriptions if
initialization fails. An invalid initial source value rejects construction. An
invalid later callback is ignored and reported. All state values use the declared
union.

## Connection behavior

- No source preserves the existing flow. Initial online permits a connection.
- Explicit connect records connection intent. Offline admits no attempt.
- Offline retires the current attempt immediately, invalidates stale callbacks,
  cancels connection and retry timers, and stops the attempt's Keepalive. It
  publishes idle in the same turn without waiting for native close.
- Use a distinct SUSPEND lifecycle event to enter idle without resetting the
  failure count. Do not call public disconnect for environmental suspension.
  Custom lifecycles used with connectivity must support SUSPEND from idle,
  connecting, ready, and backoff. Existing lifecycles without a source do not
  receive this event. Stopped remains terminal.
- Preserve desired intent through suspension. All attempt entry points, including
  reconnect, retries, and callbacks after external code, obey offline admission.
- An online transition resumes one suspended requested connection immediately.
  It does not change an active backoff. It never replaces a ready or connecting
  attempt. Duplicate signals cannot start duplicate attempts.
- Manual disconnect clears intent and suspension, cancels work, and resets retry
  history. Stop also releases the source subscription. Neither can be reversed by
  a later online signal or a callback from an older operation.
- Retry history survives offline and online transitions. Ready resets it. Preserve
  capped exponential backoff and configured jitter. No finite attempt budget is
  added to the SDK.
- `retry: null` disables timed retries. It permits one attempt after an offline
  suspension while desired intent remains. A transport close before offline must
  not erase the caller's intent needed for that recovery. A failed recovery does
  not loop without another explicit connect or offline/online cycle. Explicit
  connect from idle must remain usable after such a failure.

When a source is supplied, expose its state and suspension through stable client
snapshots, with optional `connectivity` and `suspended` fields in the public type.
Commit a new snapshot when either field changes, including while idle. Snapshot
versions must advance and repeated reads must retain the same reference. Preserve
the existing snapshot shape and behavior when no source is supplied. Define this
client observation separately from the injected lifecycle's raw snapshot. State
listeners must not receive stale snapshots after listener re-entry.

Browser online is a hint, not evidence of backend health. Keep readiness, auth,
and Keepalive responsibilities unchanged. The source stores no credentials.
RPC continues to settle requests through the existing client state subscription;
no new queue, replay path, or realtime-to-RPC dependency is added.

## Delivery and validation

The published connectivity releases, net-monitor 0.1.0 and realtime 0.2.0, are available.
The two-state contract update targets net-monitor 0.2.0 and realtime 0.3.0.
Publication and pushing are separate actions.

1. Implement the package, integration, public types, documentation, and focused tests.
2. Review runtime code, tests, contracts, and package boundaries. Correct each accepted finding.
3. Run affected tests and interface checks. Then run the full workspace health check.
4. Verify packed ESM and CommonJS exports and strict declaration consumers. Verify that the
   Realtime core works without net-monitor installed.
5. Test native browser events when browser tools are available. Identify synthetic events and
   actual network changes separately. Record environment limits.
6. Prepare net-monitor 0.2.0 and realtime 0.3.0 with Changesets. Check generated changelogs,
   dependency ranges, the lockfile, and tarballs.

The current workspace contains Bazario Labs. Test-client adoption belongs to its separate checkout.
Deliver and test the SDK composition here. Do not add that application's run management, bridge,
credentials, or retry budget.

## Required coverage

Cover initial online/offline and unsupported platform state, observer attachment and resubscription,
shared lifetime, duplicate callback registrations, errors, re-entry, and stop.
Cover offline in each active state, connect and reconnect while offline,
offline/close in both orders with retries enabled and disabled, immediate recovery,
preserved backoff count, stale timers and transport callbacks, source initialization
races, manual disconnect and stop during cleanup, and no traffic while suspended.
Cover pending RPC settlement, factory forwarding, injected lifecycle compatibility,
snapshot stability, and strict Node/SSR declarations without DOM requirements for
the monitor. Preserve the existing transport, Keepalive, and RPC contracts.

## Records

- [Package README](../../../packages/net-monitor/README.md)
- [Realtime composition](./RealtimeComposition.md)
