# @bazariodev/keepalive

Connection liveness monitoring through an abortable promise probe. Keepalive owns idle scheduling,
a probe deadline, and terminal failure notification. The consumer owns the request, response matching,
and validation. It depends only on `@bazariodev/idle-watchdog`.

## Usage

```js
import { Keepalive } from '@bazariodev/keepalive';

const keepalive = new Keepalive({
  idleMs: 30_000,
  deadlineMs: 5_000,
  probe: async (signal) => {
    // Illustrative consumer API: one request on the current connection, no retry.
    // This request uses Keepalive's signal instead of its own timeout.
    const response = await requests.request({ type: 'ping' }, { signal });
    validatePong(response); // Throw if unacceptable; fulfill only after validation.
  },
});

keepalive.onFail((failure) => {
  // The monitor is already terminal and its pending probe has been aborted.
  retireCurrentAttempt(failure);
});
keepalive.start(); // Call after the connection becomes ready.

// The parent reports validated incoming traffic only.
keepalive.activity();
keepalive.probeNow(); // Optional immediate wake/manual check; coalesces while pending.
keepalive.stop(); // Silent and terminal; abort pending work before closing transport.
```

`requests`, `validatePong`, and `retireCurrentAttempt` belong to the consumer. The handler registers
matching before sending, honors abort, and fulfills only after validating the current connection's
response. It must not retry across attempts or install a second deadline for this check.

## Contract summary

| Method | Behavior |
| --- | --- |
| `start()` | Begin idle monitoring once. |
| `activity()` | Report validated incoming traffic; refresh idleness unless a probe is pending. |
| `probeNow()` | Start an immediate check; coalesce while one is pending. |
| `onFail(listener)` | Subscribe to terminal timeout/error; return an unsubscribe function. |
| `stop()` / `[Symbol.dispose]()` | Silently abort and dispose; create a new instance to monitor again. |

Outgoing writes do not call `activity()`: local admission cannot prove the peer is alive.
Failures are `{ type: 'timeout' }` or `{ type: 'error', error }`. Explicit stop during failure
notification does not suppress other subscribers. Both durations require integer milliseconds in
`[1, 2_147_483_647]`; timers can run late under blocking, sleep, or throttling.

The [design contract](https://github.com/Bazariodev/bazario-labs/blob/main/.agent/ADR/Modules/Keepalive.md)
is the canonical reference for lifecycle, cancellation, scheduler obligations, validation, and
subscription semantics. See also the
[public declarations](https://github.com/Bazariodev/bazario-labs/blob/main/packages/keepalive/src/index.d.ts).

## TypeScript and development

Supply platform types for your runtime: `DOM` in browsers, `WebWorker` in workers, or Node typings
that provide `AbortSignal`. The package does not inject browser globals into consumers.

```sh
pnpm --filter @bazariodev/keepalive... build
pnpm --filter @bazariodev/keepalive test
pnpm --filter @bazariodev/keepalive typecheck
```

Typecheck covers browser and Worker environments with library checking enabled.
Plain JavaScript ESM/CommonJS with public TypeScript declarations. MIT — see [LICENSE](./LICENSE).
