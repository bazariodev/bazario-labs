# Historical net monitor app-adoption review

Date: 2026-10-14. Decision at that revision: **approved for the authorized app adoption**.

This record applies to net-monitor 0.1.0 and realtime 0.2.0 at SDK commit `034607d`.
The package plan is now included in the [Net Monitor ADR](../.agent/ADR/Modules/NetMonitor.md).
That ADR defines the current two-state contract and platform read errors. Keep
the review below as history. It does not approve the later API changes or prove
that app adoption is complete.

## Original review record

## Published-package delta review — 2026-10-14

The refreshed checkout at `034607d` already implements net-monitor 0.1.0,
realtime 0.2.0, and RPC 0.1.0. Registry evidence confirms net-monitor 0.1.0 is
published. Reviewed its source, declarations, README and downloaded package API,
Realtime's declarations/README/lifecycle, SDK RPC framing, and the actual test
server protocol. No blocking package or architecture finding remains.

The corrected plan pins the published monitor and injects it into the current
test-client SessionOwner. Realtime already accepts a structural source without
a net-monitor peer dependency; its factory is `createRealtimeClient`, its five
states include terminal `stopped`, and ready means transport `onOpen`, with no
mandatory handshake. SDK RPC's flat requests require adaptation to this server's
strict JSON-RPC envelope. A full client/RPC migration is unnecessary for this
request. Published monitor cleanup is `stop()` / `[Symbol.dispose]()`.

The user now authorizes release and app integration; the release is already
available, so publication is not blocked on credentials. Sequential app
implementation, independent review, and acceptance remain necessary. BC1–BC5
and the agreed promise/auth/lifetime requirements are preserved. This delta
review edited planning records only and did not run runtime tests or modify code.
SDK normal CI/package evidence reported by the parent is distinct from the
pre-existing failing security workflow; no blanket monorepo-CI claim is made.

## Historical planning review

The original review below records the earlier planning-only authorization and
stale checkout. Its missing-package, peer-dependency, and handshake statements
are superseded by the delta above and the reconciled plan.

The revised ownership matches the user's clarification. `@bazariodev/net-monitor`
belongs in `bazario-labs` and owns both the reusable source contract and browser
observation. Realtime consumes that source and remains the sole logical
connection/recovery owner. The test app consumes the package; it does not own a
duplicate monitor implementation.

No blocking findings remained in that scope amendment. At the time, the review
did not authorize or claim runtime implementation, publication, tests, commits,
or a push; the current user authorization is recorded above.

## Evidence and accepted decisions

Reviewed the earlier package plan, now included in the Net Monitor ADR, the proposed realtime ADR at
`.agent/ADR/Modules/Realtime.md`, the hierarchy reference at
`docs/realtime-client-hierarchy.html`, and the amended test-client integration
reference. The prior BC1–BC5 dispositions remain application requirements rather
than being reopened by this package ownership change.

- **Package boundary:** a small state/subscription contract, browser adapter,
  and zero runtime dependencies. No socket, client, retry callback, credential,
  React, reachability polling, or delivery policy enters the monitor.
- **Portable interface:** structural platform injection and public declarations
  that require no DOM libraries. Realtime's type-only peer/development dependency
  follows its existing transport convention and accounts for TypeScript consumers
  that omit the optional connectivity option.
- **Lifetime:** listener attachment on first subscription, release after the last,
  resampling after an observation gap, terminal disposal, isolated subscriber
  failures, and independent cleanup handles support a shared source. Clients
  borrow the source; bootstrap owns disposal.
- **SDK semantics:** the example uses the existing `createTransport` option.
  Offline `connect(): void` retains desired intent without opening a transport.
  Offline retirement and online acceleration share logical-owner generation and
  eligibility guards. Manual/fatal/auth blocks remain effective. The SDK keeps
  capped jittered backoff, no arbitrary attempt cap, and reset only after a valid
  ready handshake.
- **Consumer separation:** auth-session/application providers retain credentials;
  RPC settles its own pending operations without replay. Fixture runs, local
  bridge checks, finite retry budgets, bootstrap configuration, and React remain
  test-app concerns. The direct JSON-RPC test endpoint is correctly distinguished
  from the future realtime connect/ready wire protocol.

## Implementation handoff notes

These are nonblocking clarifications for the later concrete task list.

1. Treat implementation-task 3, integration into a future realtime package, as a
   deferred branch. It must not block package implementation or test-client
   adoption in tasks 2/4. Amend the realtime proposal now; do not implement the
   entire missing SDK merely to complete this monitor feature.
2. Task 1 should freeze the already identified duplicate-listener and terminal
   subscription behavior before code is written. Realtime must subscribe before
   sampling the current snapshot and tolerate synchronous notification; its
   initial-offline decision must use the resampled state. All attempt entry
   points, including explicit reconnect, use the same known-offline admission
   guard.
3. Preserve the existing credential-provider contract while adding connectivity.
   Auth cancellation tests concern retiring or ignoring work belonging to an old
   attempt through that contract; this feature does not introduce a new async
   credential-refresh subsystem.

The plan is ready to present as the canonical package proposal. Its later
implementation should use the documented independent implementation/review gates
and actual browser/type-consumption checks. This review wrote only this record;
the proposal, ADRs, and runtime source were not edited.
