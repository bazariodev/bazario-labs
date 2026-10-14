import { BrowserNetMonitor } from '@bazariodev/net-monitor';
import { createRealtimeClient } from '@bazariodev/realtime';
import { expect, it, vi } from 'vitest';
import { RpcClient } from '../index.js';

it('settles a pending RPC request when connectivity suspends realtime', async () => {
  const listeners = new Map();
  const platform = {
    navigator: { onLine: true },
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
  const monitor = new BrowserNetMonitor({ platform });
  let handlers;
  const realtime = createRealtimeClient({
    connectivity: monitor,
    retry: null,
    createTransport: () => ({
      start(value) {
        handlers = value;
      },
      send: vi.fn(),
      [Symbol.dispose]() {},
    }),
  });
  const rpc = new RpcClient({ channel: realtime });
  realtime.connect();
  handlers.onOpen();

  const request = rpc.request({ method: 'getProfile' });
  expect(rpc.pendingCount).toBe(1);
  const failed = expect(request).rejects.toMatchObject({
    kind: 'disconnected',
  });
  platform.navigator.onLine = false;
  platform.emit('offline');
  await failed;
  expect(rpc.pendingCount).toBe(0);

  rpc.stop();
  realtime.stop();
  monitor.stop();
});
