# Realtime, Keepalive, and RPC Composition

- Status: Accepted
- Date: 2026-10-11
- Supersedes the current decisions in [Realtime](./Realtime.md), [Keepalive](./Keepalive.md), and [RPC](./Rpc.md). Their historical records remain below their notices.

## Context

The first realtime design repeated wire and lifecycle work across a packet channel, a default connection, a retry bridge, Keepalive, and RPC. It also tied application messages to one JSON protocol. The deployed Ringotel client needs the same basic boundaries: one transport attempt, explicit desired connection state, abortable liveness checks, request correlation, and application-owned auth and recovery. It does not need the old packet protocol.

## Decision

Use one injected `RealtimeClient`. Its root factory selects defaults. The client owns connection intent, readiness, attempt replacement, retry decisions, and state events. It owns one active attempt at a time. Each attempt owns one transport; a monitor exists only when the application selects one. The client accepts messages as opaque values and defines no handshake, reserved message types, IDs, or codec.

The lifecycle uses `idle`, `connecting`, `ready`, and `backoff`, plus terminal `stopped`. Only `ready` permits sends. `disconnect()` clears intent and returns to `idle`; `reconnect()` replaces the attempt; `stop()` ends the client. Attempt identity and an operation generation reject callbacks from a retired attempt or older command. Cleanup clears ownership before it calls external code. Cleanup attempts every owned release even if one release fails.

Snapshots are stable per committed state. Callers treat the snapshot and context as read-only. `onReady` reports `initial` until this client first reaches ready, then reports `reconnect` after later ready transitions. This reason describes this client's successful history; it does not encode an application's backoff count or desired-state policy.

The root `createRealtimeClient(options)` creates the default FSM, event publisher, retry driver,
and any configured Keepalive. It selects one timer provider and shares it with the connection
deadline, default retry driver, and configured default Keepalive.

The default retry driver comes from coordination's `createBackoffScheduler`. `reconnect.jitter`
configures ratio jitter. Top-level `random` is its fallback; an explicit nested random function
takes precedence. `jitter: false` makes no random draw. Custom retry drivers and `retry: null`
bypass the default retry options.

The `RealtimeClient` class takes injected dependencies. The `/core` entry imports no default
implementation packages and keeps its native timer fallback. Standalone IdleWatchdog remains
independent of coordination. The application installs its chosen transport adapter directly.
`JsonTransport` is an optional text codec. It parses or serializes once and does not validate
the application schema.

`JsonTransport` checks incoming frame size before parsing. The default limit is 1,048,576 UTF-8 bytes. The application can set `maxIncomingBytes` to a larger positive safe integer. The codec skips frames above this limit with a warning. Root and core exports use one shared client class within each module format.

`Keepalive` retains a small probe contract. It owns two watchdogs, an abortable probe, activity reporting, and one terminal failure. It does not parse messages, generate IDs, answer peer pings, or reconnect. A custom probe owns its request format and response matching. `idleMs` may be a duration function; `deadlineMs` stays fixed. Activity cannot settle or extend a pending probe.

`RpcClient` consumes `RealtimeClient` directly through `state`, `send`, `onMessage`, and snapshot `subscribe`. It sends flat frames:

- Request: `{ id, method, params? }`
- Notification: `{ method, params? }`
- Result: `{ id, result }`
- Error: `{ id, error }`

RPC validates unknown incoming frames at its boundary. It ignores invalid values and IDs, matches only its own non-empty string IDs, and preserves notification metadata. It owns READY and response waits, cancellation, and capacity. It does not replay a request. `probe()` accepts a valid correlated error as evidence of a round trip, not evidence of authentication or application success.

## Safety rules

- A new transport belongs to each attempt. Disposal retires that attempt even if the adapter does not emit a close event.
- Message subscriptions made through the monitor's port belong to that attempt. Retirement releases them even if monitor construction fails. A failed release does not prevent other cleanup.
- A transport `onError` callback reports a diagnostic and does not retire the attempt. `onClose` reports terminal attempt metadata; the client then applies its recovery policy. A failed start, connection timeout, or monitor failure also retires the attempt.
- The newest effective lifecycle command wins during callback re-entry. An inert `connect()` does not replace an operation already in progress.
- Factories run without a receiver. A factory must not call connection handlers before `start()`. `start()` may call a handler synchronously.
- A retry driver schedules and cancels callbacks. It does not send lifecycle events. Retry callbacks run asynchronously and stale retries are ignored.
- No application message is queued or replayed across attempts. The application synchronizes after each ready event.
- `createKeepalive: null` means no monitor or probe exists. Server-specific reply behavior belongs to the application's transport or probe integration, whether a monitor is selected or not.
- Application code owns authentication, online/visibility state, wake handling, server readiness, and domain recovery.

## Removed layers

The default `ConnectionChannel`, packet parser/classifier, protocol packet types, generated tracing IDs, and `FsmDelays` lifecycle bridge are removed. They made one wire format part of the logical client and repeated policy already owned by the lifecycle. `JsonTransport` remains as an opt-in codec. The raw transport API stays unchanged. Keepalive and RPC own their own correlated checks; no generic packet lane or probe classifier crosses the client boundary.

## Ringotel operation mapping

| Ringotel operation | Composition action |
| --- | --- |
| Desired auth or online session | Application calls `connect()` after it has the required credentials and network state. |
| Reset or connection replacement | Application calls recoverable `disconnect()` or explicit `reconnect()`. |
| Dispose | Application calls terminal `stop()`. |
| State and ready events | Application subscribes to snapshots and `onReady`; it synchronizes domain state after ready. |
| JSON request or notification | Application selects `JsonTransport` and uses `RpcClient` flat frames. |
| Liveness policy | Application supplies a correlated abortable probe and timing. |

This is a composition map, not a drop-in Ringotel adapter. Authentication, wake cadence, unanswered-probe policy, endpoint framing, and backend compatibility need a later application-level adapter and tests. No Ringotel-specific API belongs in these packages.

## Consequences

The core has fewer layers and does not depend on a wire schema. Existing transport adapters keep their string or binary contracts. Applications that need JSON opt in to `JsonTransport`. Keepalive users report activity themselves or through their probe integration. RPC owns correlation without a RealtimeClient metadata channel or a peer dependency. Each package can change behind its own small interface.
