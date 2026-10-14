import NetMonitor = require('@bazariodev/net-monitor');

const source: NetMonitor.ConnectivitySource = new NetMonitor.BrowserNetMonitor({
  platform: null,
});
source.getSnapshot();
