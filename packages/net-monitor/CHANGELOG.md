# @bazariodev/net-monitor

## 0.2.0

### Minor Changes

- Remove `unknown` from `ConnectivityState`. `BrowserNetMonitor` now reports only `online` or `offline`.
  A browser value of `navigator.onLine === false` reports `offline`, including at the first sample.

  Require a boolean `navigator.onLine` value. A snapshot read or subscription throws `TypeError` when
  the platform cannot provide this value. Platform read errors are passed to the caller. A failed
  subscription releases the resources that it added and preserves other subscriptions.

  Update consumers that handle `unknown` or provide a platform without a boolean `navigator.onLine`.
  Browser online state still permits a connection attempt and does not confirm that a server is
  reachable.

## 0.1.0

### Minor Changes

- Add `BrowserNetMonitor`, a source of browser online and offline hints with no runtime dependencies.
  Observation starts with the first subscriber and stops after the last unsubscribe. Each subscription
  has its own cleanup function. Listener errors do not stop notification to other listeners.

- Provide `online`, `offline`, and `unknown` states through the structural `ConnectivitySource` port.
  Public declarations do not require DOM types. `stop()` and `[Symbol.dispose]()` stop the monitor
  permanently and keep the last snapshot.
