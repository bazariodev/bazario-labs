# Net monitor release and test-client integration plan

Date: 2026-10-14. Status: published package confirmed; app adoption authorized.
Architecture delta: approved against the implemented package API; app delivery
still requires its implementation, independent review, and acceptance gates.
Review: `NET_MONITOR_PLAN_REVIEW.md`.

## Current state and decision

The refreshed `bazario-labs` checkout at `034607d` already contains
`@bazariodev/net-monitor` 0.1.0, `@bazariodev/realtime` 0.2.0, and
`@bazariodev/rpc` 0.1.0. Registry metadata confirms net-monitor 0.1.0 was published
on 2026-10-14 at 20:17:31 UTC. Its downloaded package declarations and README
match the source contract inspected for this review. No new package release,
version bump, or publishing credentials are needed for this request.

Pin `@bazariodev/net-monitor` to exactly `0.1.0` in the test app and its npm lock.
Inject the published source into the app's existing `SessionOwner`. Do not
reimplement browser observation or use a workspace path/tarball dependency.
The user has authorized release and app adoption; release is already available.

The earlier proposal was based on a stale checkout. Its missing-package,
external type-peer, four-state lifecycle, and mandatory realtime wire-handshake
assumptions are superseded by the implemented APIs below. The existing SDK
connectivity integration needs no additional implementation for this feature.

## Ownership and small scope

| Concern | Owner |
| --- | --- |
| Connectivity state, observation, subscription and browser listeners | `@bazariodev/net-monitor` |
| SDK connection intent, attempts, sendability, backoff and restoration | Existing `RealtimeClient`, when selected by a consumer |
| This test app's connection, fixture auth, run checks and finite retry budget | Existing `SessionOwner` |
| A single physical connection attempt | Transport adapter |
| Attempt-local liveness mechanics | Keepalive |
| Credential acquisition and reuse policy | Application/authentication integration |
| Compose dependencies and own the monitor lifetime | Application bootstrap |
| Present connection state and test behavior | Test client / examples |

There is one logical recovery owner per consumer. The monitor receives no socket,
client, reconnect callback, retry policy, or credentials. It has no runtime
dependencies. Visibility, sleep/wake, active reachability probes, polling, latency
measurement, and delivery recovery are outside this feature.

Keeping SessionOwner is a scope decision, not a workaround for a missing SDK.
It already owns the test app's promise-returning Connect API, authentication
certainty, typed JSON-RPC correlation, custom IDs, heartbeat validation, owned
runs, and bounded automatic attempts. Replacing those mechanisms with Realtime,
RPC, or an FSM is a separate migration and is not required to adopt net-monitor.

## Published monitor API and lifetime

`@bazariodev/net-monitor` exports `ConnectivityState` (`online | offline |
unknown`), `ConnectivitySource` (`getSnapshot()` and `subscribe(listener)`),
`Unsubscribe`, `BrowserNetPlatform`, `BrowserNetMonitorOptions`, and
`BrowserNetMonitor`. Import these types rather than creating an app-local copy.

`new BrowserNetMonitor({ platform?, onListenerError? })` implements the source.
Its terminal cleanup methods are `stop()` and `[Symbol.dispose]()`; it has no
`dispose()` method. Platform injection is structural and public declarations do
not require DOM libraries. An unavailable boolean `navigator.onLine` yields
unknown, including ordinary Node/SSR environments.

Import and construction attach no listeners. First subscription attaches browser
online/offline observation before resampling; the last unsubscribe detaches it.
While unobserved, `getSnapshot()` resamples the platform. Resubscription resamples
changes missed during the gap. Subscription may synchronously notify, so a
consumer initializes its fields, subscribes, then reads the current snapshot.
Browser events report hints, not verified backend reachability.

State is committed before notification and duplicate states are suppressed.
Subscriber failures are contained. Each registration, including duplicate
listener functions, has an independent idempotent unsubscribe. Stop is terminal,
removes listeners, retains the last snapshot, and makes later subscriptions inert.
A consumer only unsubscribes from its borrowed source. Bootstrap stops its owned
monitor after its consumers stop; React view effect replay only resubscribes.

## Existing SDK integration

Realtime 0.2.0 already accepts an optional structural
`RealtimeConnectivitySource` through `connectivity`. Its declarations define the
port locally and do not import net-monitor, so no net-monitor peer or runtime
dependency is required. The application installs the concrete source it chooses.
An omitted source preserves the existing non-browser behavior.

The simple composition uses the factory; direct core construction additionally
requires injected `fsm` and `events`:

```ts
import { BrowserNetMonitor } from '@bazariodev/net-monitor';
import { createRealtimeClient } from '@bazariodev/realtime';

const connectivity = new BrowserNetMonitor();
const client = createRealtimeClient({ createTransport, connectivity });
client.connect();
// At application teardown:
client.stop();
connectivity.stop();
```

This documents the existing SDK API; the test app continues to compose
SessionOwner. Realtime has `idle`, `connecting`, `ready`, `backoff`, and terminal
`stopped` states. `connect(): void` retains intent while known offline; online
can resume or accelerate recovery. Manual disconnect clears intent, stop releases
the borrowed subscription, and offline suspension preserves retry history.
The default retry policy is capped exponential backoff with jitter, not the test
app's three-attempt budget. Transport readiness resets its retry counter.

Realtime passes opaque messages and enters ready when its transport calls
`onOpen`. It defines no mandatory connect/ready wire handshake, authentication,
or RPC envelope. Its optional JsonTransport only serializes/parses JSON.
Thus Realtime itself is not inherently incompatible with `/ws`. However, SDK
RPC sends `{ id, method, params? }` with generated string IDs, while this test
server requires `jsonrpc: "2.0"`, supports string/safe-integer IDs, and has a
separate `{ type: "ping", id }` heartbeat with nested error details. Swapping
RPC and liveness behavior would require explicit protocol and feature adaptation.
No such migration or backend change is part of this request.

## Test-client requirements retained

`test-client/docs/BROWSER_CONNECTIVITY_PLAN.md` remains the detailed consumer
plan. Preserve its resolved BC1–BC5: offline retirement regardless of close-event
ordering, retained eligible intent, a usable session-only manual stop, one shared
admission-counted budget, fresh bounded owned-run validation after readiness,
and recoverable observable bootstrap configuration.

Also retain prompt interrupted-connect rejection, first-cycle credential versus
accepted-credential rules, login uncertainty only after write admission, secret
redaction lifetime, stale-generation/reentrant guards, and no RPC replay.
SessionOwner borrows the package source; bootstrap owns only a default source
that it creates. Missing/initial unknown permits existing ordinary behavior;
a confirmed offline suspension requires known online for automatic restoration.
These application policies do not become monitor or generic SDK dependencies.

## Sequential remaining TODO

Use the agreed sequential Luna implementation, independent review, and fix loop.
The package and SDK connectivity implementation are already available; remaining
work is app adoption and validation.

1. Pin published net-monitor 0.1.0 and import its source types. Add the optional
   borrowed-source seam to SessionOwner, with real-monitor platform-injection
   tests for initialization, synchronous notification, and cleanup.
2. Implement offline retirement and online admission under the existing logical
   owner. Preserve all BC1–BC5, authentication, target, budget, and promise rules
   in the consumer plan; review and fix this task before composition work.
3. Compose one default monitor in bootstrap, recover public config state, and
   expose minimal offline/intent status with a usable Disconnect control. Test
   owned/borrowed lifetime, StrictMode, and no unsolicited socket creation.
4. Complete local browser acceptance and app type/lint/format/unit coverage/build
   and CI gates; update the public contract and user guide with actual behavior.
   Browser emulation must demonstrably change connectivity before claiming native
   detection. HTTP failure alone is not evidence of navigator offline.

Acceptance: the published monitor supplies the app's connectivity observation;
SessionOwner retires observed-offline attempts synchronously and admits one
eligible fresh online recovery. Manual stop, unsafe auth, removed targets, and
exhausted budgets prevent recovery. No duplicate attempt, listener leak, secret
exposure, or RPC replay. Report app acceptance separately from unrelated SDK
security-workflow failures; this plan makes no claim that every monorepo CI job
is green.
