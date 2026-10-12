# Shared Backoff Scheduler

Date: 2026-10-12
Status: In progress.

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
3. Update package documentation, current ADRs, and pending changesets.
4. Run the workspace gate and check the final scope.

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

The new tests failed before the exports existed. Coordination now passes 53 tests,
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
