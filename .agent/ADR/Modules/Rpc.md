# ADR: RPC over an injected message channel

> **Historical decision superseded.** RPC now uses flat frames and subscribes to RealtimeClient
> directly. See [Realtime, Keepalive, and RPC Composition](./RealtimeComposition.md). This record
> preserves the earlier metadata channel and envelope design for history only.

- Status: Superseded by [RealtimeComposition](./RealtimeComposition.md)
- Date: 2026-10-10

## Decision

`@bazariodev/rpc` owns request IDs and pending response correlation. Application callers supply
`{ method, params? }`; they never manage IDs. `RealtimeClient.channel` exposes `{ id?, data }`
metadata to RPC while ordinary `onMessage` keeps delivering application data only.
Incoming IDs are opaque (`unknown`) at the channel boundary. RPC narrows them to non-empty
strings before matching, without coercion or stripping. Other ID formats cannot settle requests
or become ID-less notifications, and do not terminate the underlying connection.

The channel's send preserves explicit IDs and never adds tracing IDs. Ordinary client sends retain
the opt-in, default-off tracing flag. A response carries the request ID and exactly one `result` or
`error` field in its data. Notifications carry no request ID. IDs correlate; response shape still
identifies packet role. Keepalive retains its separate typed ping/pong control protocol.
Server-to-client requests are outside this client API: ID-bearing method packets are ignored,
with no handler dispatch or automatic response.

RPC owns two channel subscriptions, one for messages and one for state. It also owns a bounded
set of operations and an ID map for sent requests. Each
operation owns its response/READY deadline and cancellation cleanup. The small internal Operation
class centralizes exactly-once settlement. Pending IDs are registered before the write. Late IDs
are ignored; duplicate active IDs are rejected. No unbounded history is retained, so injected
generators must supply fresh IDs across completions and reconnects.

READY waiting and response waiting have separate positive deadlines. Waiting notifications count
toward the same capacity as requests. Leaving READY rejects sent work; waiting work can survive
connecting/backoff but expires on its READY deadline. Explicit idle and terminal stopped release
waiting work. No operation is automatically replayed. Transport success means local admission only.

`RpcClient.probe()` fulfills on either a correlated result or a valid server error. That establishes
round-trip liveness, not authentication or application success. Keepalive can inject it through its
existing promise probe; Keepalive's deadline aborts the request signal. RPC request timers still
bound standalone calls. This requires no additional ping/pong abstraction.

## Ringotel acceptance cases

Source evidence: Ringotel's realtimeRpcClient, realtimeKeepalive, WsTransport, message send/typing/
read APIs. Current tests cover concurrent reversed replies, synchronous responses, ID-less
notifications, cancellation before/after READY, distinct deadlines, bounded capacity, disconnect,
stop, late responses, malformed errors, DI reentrancy, and an error-response liveness probe.

Channel tests exercise Bazario's message envelope and Ringotel's flat request/result/error frames.
The adapter maps `{ id, ...data }` to `{ id, data }` and preserves notification metadata. Runtime
transport errors must reach send admission; the legacy transport's silent send failures are not
copied. External validation belongs at the channel/codec boundary; RPC owns only its envelope guards.

These tests establish client contract coverage, not live backend compatibility. The Bazario
RealtimeClient's handshake remains different from Ringotel's. A future migration must supply a
compatible endpoint or protocol adapter and verify real auth, wake recovery, notification holds,
and domain synchronization. RPC never owns those application policies or native transports.

## Release contract

The initial RPC release is `0.1.0`. RPC owns its structural `RpcChannel` port and JSON value types;
its public declarations do not import realtime. Realtime remains a development dependency only,
used for runtime integration and compile-time compatibility tests against `RealtimeClient.channel`.
Coordination is RPC's only runtime dependency, and RPC has no peer dependencies.

A realtime peer range would couple RPC versioning to unrelated realtime releases: Changesets
promotes an out-of-range peer minor to a major dependent release, including during `0.x` development.
Owning the port removes that artificial coupling without claiming compatibility with future APIs.
A changed realtime channel must still pass the structural compatibility and integration tests.

## Jitter ownership

Coordination exports `createJitter({ minMs, maxMs, random? })`, a bounded integer-duration draw
function with no timers or lifecycle. IdleWatchdog accepts either a fixed duration or that function;
it draws and validates only when armed. Keepalive redraws idle timing on activity and after a
completed probe, never during a pending response. Response deadlines remain fixed.

This keeps coordination dependency-free and avoids a new dependency from Keepalive or IdleWatchdog
to coordination. The application composes the function through DI. Jitter is opt-in; fixed defaults
are unchanged. Multiple unanswered-ping budgets and accelerated verification modes remain deferred.
