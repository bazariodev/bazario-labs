# Realtime Repair Plan

Date: 2026-10-11
Status: Complete.

## Scope

Keep the current injected client and small default factory. Make four repairs.
Do not add a packet protocol, a message queue, or more lifecycle owners.
Ringotel replacement and its test suite remain separate future work.

## Accepted Behavior

- The selected transport reports open when it can send application messages.
- The application owns authentication, server readiness, and wake recovery.
- Retry and Keepalive can be supplied or omitted.
- The client sends only in ready. It does not queue or repeat messages.
- Disconnect is recoverable. Stop is terminal.
- Each attempt owns its transport, monitor, timers, and message subscriptions.
- Diagnostic transport errors report an error but do not end the attempt.
- Close, failed start, timeout, and a failed probe end the attempt.
- A rejected local send returns false and reports an error. It does not queue a
  message or end a connection that can still send.
- A transport reports close when it knows that its connection has failed.
- JSON frames have a configurable UTF-8 byte limit before parsing.
- Root and core exports use the same client class in ESM and CommonJS.

## Tasks

- [x] Release attempt message subscriptions, including failed monitor construction.
- [x] Restore the JSON frame size limit and test byte boundaries.
- [x] Share the CommonJS client class and test the packed exports together.
- [x] Align diagnostic errors and terminal failure in the client and transports.
- [x] Review the final change and run the full workspace checks.

Luna implements one task at a time. The parent reviews each result before the
next task. Add a failing test before each repair. Keep changes within this scope.
Use STE for documentation and code comments.

## Checkpoints

The local branch `codex/realtime-hardening-checkpoints` saves the full source tree
before these repairs. Its first commit includes pre-existing work for recovery.
Do not publish that commit as a feature change. Each later commit saves one repair.
The current checkout and its index remain separate from this checkpoint branch.
An archive and file hashes are also saved in
`/private/tmp/bazario-realtime-hardening-checkpoints`.

## Checks

- Failed monitor construction leaves no attempt message subscriptions.
- Cleanup continues if one release fails. Retired callbacks remain inert.
- JSON limits use UTF-8 bytes and allow an explicit larger limit.
- Packed ESM and CommonJS root and core exports share class identity.
- A diagnostic error keeps the attempt. A terminal failure permits recovery.
- A failed WebSocket does not wait for a native close event to end the attempt.
- Focused tests, build, declarations, lint, and the workspace suite pass.
- Files outside this repair scope retain their original content.

## Results

`pnpm health` passed on 2026-10-11. The check built the packages, checked their
declarations, checked 216 files with Biome, and passed 568 tests in 51 test files.
The suite includes packed ESM and CommonJS consumers and local WebSocket tests.
The log is saved at `/private/tmp/bazario-realtime-hardening-health.log`.

Two additional checks changed source copies in temporary directories. Removal
of the UTF-8 byte check caused the multibyte boundary test to fail. Removal of
the current attempt check after an error callback caused the disposal test to
fail. These checks did not change workspace source.

Before the final review correction, the file hash check found 18 changed source
files, all within the repair scope. No original file was removed. The checkout
commit and staged entries did not change during that repair pass. This plan was
the only new source file from the repair work.

## Repair Commits

The checkpoint branch contains these local commits after the source snapshot:

- `deaf6fa1`: Release subscriptions owned by retired attempts.
- `439e522f`: Bound incoming JSON frames by UTF-8 bytes.
- `bfe9dce9`: Share constructors across CommonJS entry points.
- `da5e03ba`: Separate diagnostics from terminal transport failure.

No package was published. Ringotel integration has not started.

## Final Review Correction

The cleanup test used a shared registration count in its failure condition.
Both subscriptions changed that count before cleanup, so the test did not throw.
Each release now uses its own registration number. The first release throws one
known error. The test checks that this error is reported once, both releases run,
no subscriptions remain, and the transport is disposed.

The current public type is `RealtimeClientDeps`. Constructor parameters and
consumer examples use `deps`. Current documentation uses dependencies. Historical
decision records retain their old API names.

`pnpm health` passed again after these corrections: package builds, declaration
checks, Biome, and all 568 tests passed. The log is saved at
`/private/tmp/bazario-realtime-final-review-health.log`.

The user approved local commits after this review. The reviewed work is saved by
responsibility on the current `main` branch:

- `0546fc5`: Transport correction.
- `c54ffd8`: Timing primitives and generic Keepalive.
- `e150d12`: Realtime composition, cleanup regression, and dependency names.
- `4d2f8c3`: RPC framing and direct realtime integration.

The documentation commit includes this record, the plans, the guides, the roadmap,
and the historical realtime decision record. Unrelated documentation edits remain
in the working tree. No commits were pushed and no package was published.
