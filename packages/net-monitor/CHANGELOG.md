# @bazariodev/net-monitor

## 0.1.0

### Minor Changes

- Add `BrowserNetMonitor`, a source of browser online and offline hints with no runtime dependencies.
  Observation starts with the first subscriber and stops after the last unsubscribe. Each subscription
  has its own cleanup function. Listener errors do not stop notification to other listeners.

- Provide `online`, `offline`, and `unknown` states through the structural `ConnectivitySource` port.
  Public declarations do not require DOM types. `stop()` and `[Symbol.dispose]()` stop the monitor
  permanently and keep the last snapshot.
