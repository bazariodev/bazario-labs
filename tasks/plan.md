# Plan: Simplify the Realtime Client

Date: 2026-10-11
Status: Complete. The simpler design passed parent review and the final workspace gate.
Task list: [todo.md](./todo.md)

## Goal

Build one client from replaceable parts. Keep connection recovery safe. Remove the built-in
server protocol. Keep the interfaces suitable for a later Ringotel integration.
Ringotel replacement and execution of its test suite are separate future work.

## Design

- One RealtimeClient constructor accepts an FSM, events, and a fresh transport factory.
- Retry and Keepalive can be supplied or omitted. The core constructs no package components.
- One factory builds the default components. It does not use an inherited client wrapper.
- The core forwards messages without checking application fields or creating envelopes.
- Existing raw transports keep string and byte payloads. An optional JSON transport converts
  values once. It does not require packet types, protocol versions, or connection IDs.
- Transport open means ready. A server-specific adapter can own additional readiness work.
- The FSM has idle, connecting, ready, backoff, and stopped. Stopped is terminal and observable.
  This removes the separate terminal-state channel and lets RPC subscribe to the client directly.
- A retry scheduler accepts an attempt number and a callback, and returns cancellation.
  The FSM owns the attempt count. The client guards scheduled callbacks with operation identity.
  There is no FsmDelays bridge or retry subscription to the FSM.
- Keepalive accepts an abortable probe and generic activity. It owns idle and response deadlines.
  The probe owns request creation, response matching, and subscription cleanup.
- RPC owns flat request and response fields, including IDs. It uses the client's message and
  snapshot subscriptions. There is no realtime-owned metadata channel.

## Safety Rules

The client owns one active attempt. Each attempt owns its transport, connection deadline, and
monitor. Remove ownership before cleanup. A new lifecycle command supersedes an older command.
Check identity after external factories, callbacks, monitor operations, and state publication.
Do not wait for a native close event to retire an attempt. Ignore all retired callbacks.
A failed initial connection, a dead ready connection, and a failed probe can enter backoff.
Without retry, failure returns to idle and permits a later connect. Stop cancels all resources.

Incoming activity can delay the next idle probe. It cannot complete an active probe or move its
response deadline. A completed correlated exchange proves liveness. A write alone does not.
Probe and RPC IDs belong to their owners. There is no application send queue or replay.

## Ringotel Fit

Support raw JSON objects through the JSON transport, fresh URL/auth resolution per attempt,
ready on open, explicit recoverable disconnect/reconnect, terminal stop, immediate probing,
and RPC requests with flat id/method/params and id/result/error responses.
Auth state, online state, wake detection, session recovery, and business synchronization stay in
application owners. Do not add Ringotel-specific methods or copy its stop microtasks.
Document any behavior that needs adaptation in the future integration.

## Sequence

1. Make Keepalive independent of packet shape and verify probe cancellation and deadlines.
2. Implement the direct client and retry scheduler with ownership regressions.
3. Add the small default factory and JSON transport. Remove old protocol and composition layers.
4. Move RPC framing to RPC and verify direct client integration.
5. Update public types, package metadata, README, ADRs, guides, and pending changesets.
6. Review the complete change and run the workspace health gate once after final fixes.

Luna implements one assigned task at a time. The parent reviews each result before the next task.
The parent can return a task for corrections. No files are staged, committed, versioned, or published.
Preserve changes outside the approved realtime, Keepalive, RPC, and documentation scope.

## Verification

Keep regression coverage for synchronous start callbacks, factory failure, reentrant cleanup,
stale retry, late socket events, dead sockets without close events, probe failure during traffic,
listener reentry, terminal cleanup, and omitted parts. Remove tests only when the behavior belongs
to the deleted protocol, and record that distinction. Verify browser/worker and ESM/CommonJS types,
packed standalone consumers, real local WebSocket behavior, lint, and the full workspace suite.
Do not claim that the Ringotel test suite passed. That integration is deferred.

## Final Review Finding

A URL callback can disconnect during WebSocket startup. The adapter then creates a socket after
disposal. The client stays idle, and even terminal stop leaves that socket live. The final task
includes a small adapter fix and regressions for startup disposal. This fix is part of the
connection-ownership goal. Other transport behavior stays outside this change.

## Completion

All six tasks are complete. The final workspace gate passed 545 tests, builds, type checks,
and lint. Packed ESM/CommonJS runtime and strict type consumers, loopback WebSocket/HTTP
integration, and startup-disposal regressions passed. Realtime runtime source decreased from
1100 to 746 lines; its declarations decreased from 443 to 200 lines. Nine obsolete runtime
files and two unused runtime dependencies were removed. Keepalive source decreased from
203 to 130 lines. The original lifecycle protection remains and has regression evidence.

No Ringotel code or tests were changed. Its later integration must map application lifecycle
and probe policy to the documented ports. No code was staged, committed, or published.
