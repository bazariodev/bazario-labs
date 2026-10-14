import NetMonitor = require('@bazariodev/net-monitor');

const source: NetMonitor.ConnectivitySource = new NetMonitor.BrowserNetMonitor({
  platform: { navigator: { onLine: true } },
});
source.getSnapshot();

// @ts-expect-error A supplied platform must include a boolean onLine value.
new NetMonitor.BrowserNetMonitor({ platform: { navigator: {} } });

// @ts-expect-error A platform cannot be null.
new NetMonitor.BrowserNetMonitor({ platform: null });
