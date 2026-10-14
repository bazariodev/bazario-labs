import Realtime = require('@bazariodev/realtime');

import type { Emitter } from '@bazariodev/coordination';
import type { Fsm } from '@bazariodev/fsm';
import type { Keepalive } from '@bazariodev/keepalive';
import type { Transport } from '@bazariodev/transport';

type Context = Readonly<{ attempt: number }>;
declare const fsm: Fsm<
  Realtime.RealtimeState,
  Realtime.RealtimeLifecycleEvent,
  Context
>;
declare const events: Emitter<Realtime.RealtimeEventMap<unknown>>;
declare const transport: Transport;
declare const keepalive: Keepalive;
const connectivity: Realtime.RealtimeConnectivitySource = {
  getSnapshot: () => 'unknown',
  subscribe: () => () => {},
};
const jsonOptions: Realtime.JsonTransportOptions = {
  maxIncomingBytes: 2_097_152,
  warn(message) {
    void message;
  },
};
const deps: Realtime.RealtimeClientDeps<unknown> = {
  fsm,
  events,
  createTransport: () => new Realtime.JsonTransport(transport, jsonOptions),
  createKeepalive: () => keepalive,
  connectivity,
  retry: null,
};
const core = new Realtime.RealtimeClient(deps);
const client = Realtime.createRealtimeClient({
  createTransport: () => transport,
  connectivity,
  retry: null,
});
client.send('hello');
core.stop();
client.stop();

Realtime.createRealtimeClient({
  createTransport: () => transport,
  connectivity: {
    // @ts-expect-error Connectivity uses the declared state union.
    getSnapshot: () => 'connected',
    subscribe: () => () => {},
  },
});

const jitterClient = Realtime.createRealtimeClient({
  createTransport: () => transport,
  reconnect: {
    jitter: { minRatio: 0.2, maxRatio: 0.8, random: Math.random },
  },
});
jitterClient.stop();
Realtime.createRealtimeClient({
  createTransport: () => transport,
  reconnect: { jitter: false },
});
Realtime.createRealtimeClient({
  createTransport: () => transport,
  reconnect: {
    // @ts-expect-error nested random must return a number
    jitter: { random: () => '0.5' },
  },
});
Realtime.createRealtimeClient({
  createTransport: () => transport,
  reconnect: {
    // @ts-expect-error jitter must be false or an options object
    jitter: 1,
  },
});
