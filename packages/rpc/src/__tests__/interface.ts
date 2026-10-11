import type { RealtimeClient } from '@bazariodev/realtime';
import {
  type RpcChannel,
  RpcClient,
  RpcError,
  RpcResponseError,
} from '@bazariodev/rpc';

declare const realtime: RealtimeClient;
const channel: RpcChannel = realtime;
channel.onMessage((message) => {
  // @ts-expect-error Incoming frames are unknown until RPC validates them.
  const unchecked: string = message;
  void unchecked;
});
// @ts-expect-error Outgoing IDs must be strings when supplied.
channel.send({ id: 7, method: 'ping' });
channel.subscribe((snapshot) => {
  const state: 'idle' | 'connecting' | 'ready' | 'backoff' | 'stopped' =
    snapshot.value;
  void state;
});
const rpc = new RpcClient({ channel, createRequestId: () => 'fresh-id' });
const unknownResult: Promise<unknown> = rpc.request({ method: 'getUserInfo' });
const typedResult: Promise<{ name: string }> = rpc.request<{ name: string }>({
  method: 'getUserInfo',
});
const controller = new AbortController();
const probe: Promise<void> = rpc.probe(
  { method: 'ping' },
  { signal: controller.signal },
);
rpc.notify({ method: 'messageTyped', params: { sessionid: 'one' } });
const unsubscribe: () => void = rpc.onNotification(({ method }) => {
  const value: string = method;
  void value;
});
unsubscribe();
void [
  unknownResult,
  typedResult,
  probe,
  new RpcError('timeout', 'timed out'),
  new RpcResponseError({ code: 500 }, 'ping'),
];
// @ts-expect-error caller does not assign request IDs
rpc.request({ method: 'getUserInfo', id: 'caller-id' });
// @ts-expect-error method required
rpc.request({ params: null });
// @ts-expect-error parameters must be JSON
rpc.request({ method: 'invalid', params: new Map() });
// @ts-expect-error invalid generator
new RpcClient({ channel, createRequestId: () => 1 });
// @ts-expect-error raw transports are not message channels
new RpcClient({ channel: { send() {} } });
rpc[Symbol.dispose]();
