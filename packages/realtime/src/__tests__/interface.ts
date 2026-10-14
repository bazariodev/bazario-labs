import type { Emitter } from '@bazariodev/coordination';
import type { Fsm } from '@bazariodev/fsm';
import type { Keepalive } from '@bazariodev/keepalive';
import type { Transport } from '@bazariodev/transport';
import { RealtimeClient as CoreRealtimeClient } from '../core.js';
import {
  createRealtimeClient,
  JsonTransport,
  type JsonTransportOptions,
  RealtimeClient,
  type RealtimeClientDeps,
  type RealtimeConnectivitySource,
  type RealtimeEventMap,
  type RealtimeLifecycleEvent,
  type RealtimeLogger,
  type RealtimeMonitor,
  type RealtimeRetry,
  type RealtimeSnapshot,
  type RealtimeState,
} from '../index.js';

type Context = Readonly<{ attempt: number }>;
declare const fsm: Fsm<RealtimeState, RealtimeLifecycleEvent, Context>;
declare const events: Emitter<RealtimeEventMap<unknown>>;
declare const transport: Transport;
declare const keepalive: Keepalive;
const logger: RealtimeLogger = { debug() {}, warn() {}, error() {} };
const connectivity: RealtimeConnectivitySource = {
  getSnapshot: () => 'online',
  subscribe: () => () => {},
};

const unknownSource: RealtimeConnectivitySource = {
  // @ts-expect-error The state type has no third value.
  getSnapshot: () => 'unknown',
  subscribe: () => () => {},
};
void unknownSource;
const jsonOptions: JsonTransportOptions = {
  maxIncomingBytes: 2_097_152,
  warn(message) {
    void message;
  },
};

const deps: RealtimeClientDeps<unknown> = {
  fsm,
  events,
  createTransport: () => new JsonTransport(transport, { warn: logger.warn }),
  createKeepalive: () => keepalive,
  connectivity,
  retry: {
    schedule(attempt, callback) {
      const version: number = attempt;
      callback();
      void version;
      return () => {};
    },
  } satisfies RealtimeRetry,
  logger,
};
const core = new RealtimeClient(deps);
const coreAlias = new CoreRealtimeClient(deps);
core.onMessage((message) => {
  const value: unknown = message;
  void value;
});
core.subscribe((snapshot) => {
  const observed: RealtimeSnapshot = snapshot;
  void observed;
});
core.stop();
coreAlias.stop();

const defaultClient = createRealtimeClient({
  createTransport: () => transport,
  connectivity,
  retry: null,
  logger,
});
defaultClient.connect();
defaultClient.send('raw text');
// @ts-expect-error The raw factory accepts text and bytes only.
defaultClient.send({ id: 'x', method: 'sample', params: null });
defaultClient.onMessage((message) => void message);
defaultClient.stop();

createRealtimeClient({
  createTransport: () => transport,
  connectivity: {
    // @ts-expect-error Connectivity uses the declared state union.
    getSnapshot: () => 'connected',
    subscribe: () => () => {},
  },
});

const jsonClient = createRealtimeClient({
  createTransport: () => new JsonTransport(transport, jsonOptions),
  retry: null,
});
jsonClient.send({ id: 'x', method: 'sample', params: null });
jsonClient.stop();

const jitterClient = createRealtimeClient({
  createTransport: () => transport,
  reconnect: {
    jitter: { minRatio: 0.2, maxRatio: 0.8, random: Math.random },
  },
});
jitterClient.stop();
createRealtimeClient({
  createTransport: () => transport,
  reconnect: { jitter: false },
});
createRealtimeClient({
  createTransport: () => transport,
  reconnect: {
    // @ts-expect-error nested random must return a number
    jitter: { random: () => '0.5' },
  },
});
createRealtimeClient({
  createTransport: () => transport,
  reconnect: {
    // @ts-expect-error jitter must be false or an options object
    jitter: 1,
  },
});

type CustomMessage = Readonly<{ data: string }>;
declare const customDeps: RealtimeClientDeps<CustomMessage>;
const customCore = new RealtimeClient(customDeps);
customCore.send({ data: 'typed' });
// @ts-expect-error The core preserves the injected message type.
customCore.send('wrong');
customCore.stop();

// @ts-expect-error The core requires its injected lifecycle dependencies.
new RealtimeClient({ createTransport: () => new JsonTransport(transport) });
// @ts-expect-error The root factory requires a raw transport factory.
createRealtimeClient({});

const monitor: RealtimeMonitor = keepalive;
void [monitor, defaultClient, jsonClient, customCore];
