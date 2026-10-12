# @bazariodev/coordination

## 1.1.0

### Minor Changes

- 2dd7f1f: Add `defaultScheduler` and `createBackoffScheduler` for stateless timer access and independently
  cancellable backoff callbacks with configurable ratio jitter. The caller counts attempts and
  decides whether to retry.
- c54ffd8: Add `createJitter`, a timer-free function factory for bounded integer durations with injected
  randomness. Bounds are inclusive positive integers from 1 through 2_147_483_647. Invalid bounds,
  including zero, fail at construction; each draw validates its random result. Equal bounds skip
  randomness. The returned function can be injected into idle-duration consumers.

### Patch Changes

- Build the JavaScript package with the shared Rollup script. Preserve ESM and CommonJS exports, source maps, and public declaration files.

## 1.0.0

### Major Changes

- Initial stable release of dependency-free FIFO storage, synchronous and asynchronous task executors, and a typed event emitter.
- Requires Node.js 22 or newer for the native `Promise.withResolvers()` API.
