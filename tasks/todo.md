# Realtime Simplification Tasks

Plan: [plan.md](./plan.md)
Status: Complete. Luna implemented each task under parent review.

## 1. Generic Keepalive

- [x] Remove built-in packet fields, request IDs, and peer replies.
- [x] Require an abortable probe; expose generic activity.
- [x] Preserve idle timing, bounded active probes, cancellation, and failure cleanup.
- [x] Verify focused Keepalive behavior, types, and lint.

Evidence: Parent reviewed the generic probe and activity flow. The new activity regression failed
before the change. All 54 Keepalive tests passed, with build, browser/worker and CommonJS type
checks, and scoped lint. Packet-only tests and the request-ID helper were removed because their
wire responsibilities no longer belong to Keepalive. Deadline and cancellation checks remain.

## 2. Direct Client and Retry

- [x] One injected client, one active transport attempt, and no payload classification.
- [x] Keep replaceable FSM and events, an observable terminal state, and optional parts.
- [x] Use explicit retry scheduling and cancellation without FsmDelays or synthetic interfaces.
- [x] Preserve ownership and reentrant cleanup regressions.

Evidence: Parent reviewed the direct client and returned state-delivery, receiver, and late
unsubscribe issues for correction. The opaque-message regression failed before the change. All
33 direct-client and retry tests passed after corrections, with scoped lint, build, and diff checks.
Legacy default and RPC tests are migrated in the next dependent tasks.

## 3. Default Factory and JSON Transport

- [x] Assemble defaults in one factory; validate each component's own options.
- [x] Add optional JSON encoding without reserved packet fields.
- [x] Delete the old protocol, connection wrapper, inherited client wrapper, and unused helpers.
- [x] Verify raw messages, Ringotel-style JSON, custom parts, and local WebSocket recovery.

Evidence: Parent removed implicit JSON selection and repeated factory validation from the draft.
The factory now accepts raw and custom transports; JSON is explicit. All 73 realtime tests passed,
including actual abort-cleanup cases, half-open replacement, shutdown violations, local WebSocket
behavior, and packed isolated ESM/CommonJS runtime and strict type consumers. Build, browser/worker
types, scoped lint, pack contents, and diff checks passed. Nine obsolete runtime files were removed.
Runtime source decreased from 1100 to 746 lines at this checkpoint.

## 4. RPC Ownership

- [x] Use flat request and response fields and direct client subscriptions.
- [x] Preserve RPC bounds, correlation, abort, notification, and disconnect behavior.
- [x] Verify direct JSON client integration and ESM/CommonJS public contracts.

Evidence: The direct flat-frame regression failed on the old subscribeState contract. All 39 RPC
tests passed, with build, browser/worker and CommonJS types, scoped lint, and diff checks. Parent
review strengthened late-probe ID and direct-reconnect cases; all four integration tests then
passed. RPC owns framing and correlation. No Ringotel code or tests were changed or executed.

## 5. Documentation and Packaging

- [x] Keep declarations small and independent of default package types.
- [x] Remove unused runtime dependencies; regenerate the lockfile with pnpm.
- [x] Update README, ADRs, guides, and pending changesets to the final API.
- [x] Record Ringotel fit and the deferred integration boundary.
- [x] Verify examples, packed consumers, and documentation links.

Evidence: Parent corrected stale monitor-pairing, peer-reply, type-version, and validation claims.
The current decision record preserves links to superseded records. Package examples and strict
consumers compile. Static HTML, script, local-link and anchor checks passed. Rendered browser
preview remains unverified. Required defaults now use undefined-only selection. Keepalive keeps
its published scheduler alias; Changesets status shows the intended minor package changes.

## 6. Final Review and Verification

- [x] Review the complete source and correct any remaining ownership defects.
- [x] Run pnpm health after final code changes; include local networking when required.
- [x] Check scope against the saved baseline and run git diff --check.
- [x] Report the result, remaining limits, and the deferred Ringotel integration.

Evidence: Final review found and fixed socket allocation after startup disposal and unhandled
Node ws errors during pending-connect disposal. Both had failing reproductions and regression
coverage. Parent reran the original reproductions successfully. An isolated guard mutation failed
the two cleanup/reconnect tests, which proves that the lifecycle guard protects observable behavior.
The final pnpm health run exited 0 with builds, type checks, lint, and 545 passing tests, plus the
coordination example. Real loopback WebSocket/HTTP tests and isolated packed ESM/CommonJS and
strict type consumers passed. Changesets status and diff checks passed. The lockfile changed only
to remove two unused realtime dependency links. All tracked files outside the approved scope
match the task baseline. No files were staged, committed, versioned, or published.

Ringotel replacement and execution of its tests remain separate future work. HTML source, links,
and scripts pass static checks; rendered preview remains unverified under the browser restriction.
