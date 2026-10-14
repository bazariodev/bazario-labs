# @bazariodev/realtime

## 0.3.0

### Minor Changes

- Remove `unknown` from `ConnectivityState` and default connectivity to `online`. Custom connectivity
  sources must return only `online` or `offline`. Update sources that previously returned `unknown`.

  Remove the recovery rules for `unknown`. Offline state suspends a requested connection. Online state
  permits recovery. Keep connection intent, retry history, manual disconnect, and terminal stop behavior.

## 0.2.0

### Minor Changes

- Add an optional `connectivity` source to `RealtimeClient` and `createRealtimeClient()`. Known offline
  state suspends the requested connection and keeps retry history. Online state resumes the connection.
  Manual `disconnect()` and `stop()` prevent automatic recovery. With `retry: null`, an offline period
  permits one recovery attempt after online state returns.

- Add `connectivity` and `suspended` fields to snapshots when a source is supplied. Keep snapshot
  references stable until a change occurs. Without a source, keep the existing lifecycle snapshot
  and connection behavior. Realtime does not require the net-monitor package.

  An injected lifecycle used with connectivity must accept `SUSPEND` from `idle`, `connecting`,
  `ready`, and `backoff`. This event returns to `idle` and keeps `context.attempt`. The lifecycle must
  also accept `DISCONNECT` from `idle` and reset `context.attempt`.

## 0.1.0

### Minor Changes

- e150d12: Provide one injected `RealtimeClient` with a small default factory. The client owns connection intent, readiness, attempt replacement, and recovery. It passes opaque messages and defines no handshake, packet envelope, ping/pong protocol, or tracing IDs. `JsonTransport` is an opt-in text codec. Keepalive runs only when the application supplies a probe or monitor. The `/core` entry has no imports from the default implementation packages; the root factory uses the selected defaults.

  Release attempt message subscriptions even if monitor construction fails. Limit incoming JSON text to 1,048,576 UTF-8 bytes by default, with a configurable `maxIncomingBytes`. Share client and JSON transport classes between root and core exports in ESM and CommonJS.

  Keep transport diagnostics separate from terminal attempt close. A transport `onError` reports a diagnostic and leaves the current attempt active; `onClose`, failed start, timeout, or monitor failure ends the attempt and allows recovery. The client reports terminal close details through its public `onError` event.

  The default retry driver uses coordination's `createBackoffScheduler`. The top-level `random`
  option supplies its fallback source. `reconnect.jitter` accepts `false` or ratio settings; an explicit
  nested random function takes precedence, and disabled jitter makes no random draw.

### Patch Changes

- Build the JavaScript package with the shared Rollup script. Preserve ESM and CommonJS exports, source maps, and public declaration files. Keep root/core class identity in both module formats and keep the core entry independent of default implementation packages.
- Updated dependencies [2dd7f1f]
- Updated dependencies [c54ffd8]
- Updated dependencies [c54ffd8]
- Updated dependencies
  - @bazariodev/coordination@1.1.0
  - @bazariodev/keepalive@0.2.0
  - @bazariodev/fsm@1.1.2
