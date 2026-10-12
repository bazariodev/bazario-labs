# Shared Backoff Scheduler

Date: 2026-10-12
Status: Complete.

## Contract

- Coordination exports `defaultScheduler` and `createBackoffScheduler(options)`.
- The raw provider has `setTimeout` and `clearTimeout`. It holds no job state.
- Backoff exposes `schedule(attempt, callback)`. Each call returns cancellation.
- Attempts start at one. The caller owns the count and reset decisions.
- Defaults remain 500 ms, a factor of 2, a 30,000 ms cap, and full jitter.
- `jitter: false` uses the capped exponential delay without a random draw.
- Jitter accepts `minRatio`, `maxRatio`, and an injected `random` function.
- Ratios must be finite, nonnegative, and ordered. Equal ratios skip randomness.
- Multiply the capped base delay by the selected ratio, round down, and cap the
  result at `maxDelayMs`. Zero delays remain asynchronous with the default provider.
- Cancellation is idempotent. Cancelled or completed callbacks cannot run again.
- Validate delay options before scheduling. Preserve the platform timer limit.
- The realtime factory selects the shared provider when no custom one is supplied.
- The factory passes that provider to the client, backoff, and default Keepalive.
- Keep the local native fallback for direct core use and standalone IdleWatchdog.
- Keep the core independent of concrete coordination implementations.
- Move the `createRetry` helper to coordination as `createBackoffScheduler`.
- Preserve injected retry implementations and `retry: null`.
- Keep the existing top-level realtime `random` option. An explicit
  `reconnect.jitter.random` takes precedence. Disabled jitter makes no random draw.

## Tasks

1. [x] Add coordination runtime, declarations, and tests. Review the result.
2. [x] Integrate realtime, move helper tests and exports, and test injection. Review.
3. [x] Update package documentation, current ADRs, and pending changesets. Review.
4. [x] Run the workspace gate and check the final scope.

Luna implements one task at a time. The parent reviews each result before the
next task. Use plain JavaScript, external declarations, Vitest, Biome, and STE.
Save each verified code increment in a local commit. Do not push or publish.

## Scope

Change coordination, realtime, their current documentation, and their changesets.
Do not change Ringotel or integrate its client. Keep unrelated working-tree files.
The source snapshot and hashes are saved at
`/private/tmp/bazario-backoff-scheduler-baseline`.

## Checks

- Default, disabled, configured, equal-ratio, and capped jitter behavior.
- Injected random and timer providers, including provider failure.
- Independent jobs, cancellation, stale callbacks, and callback reentry.
- ESM, CommonJS, browser and worker declarations, and isolated core consumers.
- Realtime connection timeout, retry, and Keepalive use the injected provider.
- Existing realtime recovery and omitted-component tests remain valid.
- No changes to unrelated files or staged entries.

## Task 1 Evidence

The new tests failed before the exports existed. At this checkpoint, coordination passed 53 tests,
its build, ESM and CommonJS consumer checks, browser and worker type checks, and
Biome. The declarations use opaque handles and add no global timer type reference.
The additional declaration check supplied the existing executor `AbortSignal`
type, without timer globals.

Removing the active-callback guard in a temporary source copy caused two tests
to fail. Those tests check cancelled jobs, repeated callbacks, and cleanup failure.
The workspace source was not changed by this check.

## Task 2 Evidence

Four of the five initial factory tests failed before integration because nested
jitter settings were ignored. The completed realtime suite passes 96 tests,
including local WebSocket tests. The build, declarations, browser and worker type
checks, Biome, and diff checks pass. Packed ESM and CommonJS runtime and type
consumers pass. The core still loads without the default implementation packages.

The old retry tests were moved to coordination's scheduler coverage. The duplicate
realtime helper and its exports were removed. The new factory tests cover shared
timer injection, jitter configuration, disabled draws, and random-source selection.

## Task 3 Evidence

Updated coordination and realtime package guidance, current coordination and realtime
composition ADRs, root package overview, and pending changesets. Added the coordination minor
changeset and documented migration from realtime's removed `createRetry` helper. The README
examples compile against the package declarations.

## Final Review and Verification

The provider check initially required an object container. That rejected callable
providers with the required operations. A new test failed on that restriction.
The check now validates only `setTimeout` and `clearTimeout`; all 16 scheduler
tests pass. Coordination passes 54 package tests.

`pnpm health` passed on 2026-10-12: builds, declarations, lint, and 585 tests in
52 test files. Biome checked 217 files without changes. The suite includes local
HTTP and WebSocket tests and packed ESM and CommonJS consumers. The log is saved at
`/private/tmp/bazario-backoff-scheduler-health.log`.

Changesets status selects coordination `1.1.0` and realtime `0.1.0` for their
pending minor releases. Package versions were not changed. No package was published.

The scope check found 19 changed files, five new files, and the two removed retry
files. All are within this task. The five unrelated documentation files match the
saved baseline. No Ringotel file or test was changed.

## Local Commits

- `1161448`: Coordination timer provider and configurable backoff.
- `fad0f6f`: Realtime factory integration and helper migration.
- `dc44d67`: Structural timer provider validation.

The final documentation commit includes the examples, decision records, pending
changesets, and this verification record. No commits were pushed.

## Documentation review repairs

Clarified that `createJitter` has contract-test coverage but no runtime adopter, while the
Realtime factory uses `defaultScheduler` and `createBackoffScheduler`. The ADR now limits this
addition to one-shot callback scheduling and identifies `fsm-retry` as a future policy built on
the shared scheduler. Updated the roadmap, package summaries, error table, release notes, and
standalone realtime example. The validation below includes these repairs.

## Review Validation (2026-10-12)

All ten attached findings were checked against the current source and tests. The code and
documentation repairs are complete. The optional removal of top-level realtime `random` was
not applied: this option is part of the accepted contract. Its inheritance now uses one condition.

Added coverage for omitted jitter, each timer operation, invalid callbacks and jitter options,
accepted delay bounds, random calls without a receiver, and exact error identity. The native
timer test name now states its observed behavior. All 13 targeted mutations caused test failures
in temporary source copies; the workspace code was not changed by those checks.

`pnpm health` passed with 588 tests, package builds, declarations, and lint. The repaired README
example compiles, local documentation links resolve, and Changesets status passes. The log is at
`/private/tmp/bazario-scheduler-review-fixes-health.log`.

The source and test repairs are saved in local commit `370d30a`. Documentation repairs are saved
separately. The targeted ABOUT updates remain with that file's existing uncommitted document
pass. The other four pre-existing documentation edits match the saved baseline. No versions
were changed and no package was published.
