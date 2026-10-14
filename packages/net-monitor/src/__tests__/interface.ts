import type {
  BrowserNetPlatform,
  ConnectivitySource,
  ConnectivityState,
} from '../index.js';
import { BrowserNetMonitor } from '../index.js';

const platform: BrowserNetPlatform = {
  navigator: { onLine: true },
  addEventListener: (_type, _listener) => {},
  removeEventListener: (_type, _listener) => {},
};
const source: ConnectivitySource = new BrowserNetMonitor({ platform });
const state: ConnectivityState = source.getSnapshot();
source.subscribe((value) => {
  const valid: ConnectivityState = value;
  void valid;
});
void state;

// @ts-expect-error Connectivity states use the declared union.
const invalid: ConnectivityState = 'connected';
void invalid;
