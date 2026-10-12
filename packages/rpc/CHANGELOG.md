# @bazariodev/rpc

## 0.1.0

### Minor Changes

- 4d2f8c3: Send flat `{ id, method, params? }` requests and `{ method, params? }` notifications. Match flat result and error responses through the `RealtimeClient` message and snapshot subscriptions. RPC ignores malformed and unrelated incoming frames. It preserves bounded READY and response waits, cancellation, capacity, and no-replay behavior. A correlated server error can prove a probe round trip without making the application request successful.

### Patch Changes

- Build the JavaScript package with the shared Rollup script. Preserve ESM and CommonJS exports, source maps, and public declaration files.
- Updated dependencies [2dd7f1f]
- Updated dependencies [c54ffd8]
- Updated dependencies
  - @bazariodev/coordination@1.1.0
