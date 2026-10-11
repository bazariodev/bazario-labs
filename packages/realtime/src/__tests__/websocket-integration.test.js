import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketAdapter } from '@bazariodev/transport';
import { expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createRealtimeClient, JsonTransport } from '../index.js';

it('keeps pending ws close errors handled after adapter disposal', () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const script = `
import WebSocket from './packages/realtime/node_modules/ws/wrapper.mjs';
import { WebSocketAdapter } from './packages/transport/src/websocket-adapter.js';

const handlers = { onOpen() {}, onMessage() {}, onError() {}, onClose() {} };
const options = { url: 'ws://127.0.0.1:9', WebSocket };
let adapter;
if (process.env.ADAPTER_CASE === 'constructor-disposal') {
  function DisposingWebSocket(url, protocols) {
    const socket = new WebSocket(url, protocols);
    adapter[Symbol.dispose]();
    return socket;
  }
  adapter = new WebSocketAdapter({ ...options, WebSocket: DisposingWebSocket });
  adapter.start(handlers);
} else {
  adapter = new WebSocketAdapter(options);
  adapter.start(handlers);
  adapter[Symbol.dispose]();
}
await new Promise((resolve) => setTimeout(resolve, 40));
`;

  for (const testCase of ['immediate-disposal', 'constructor-disposal']) {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: root,
        env: { ...process.env, ADAPTER_CASE: testCase },
        encoding: 'utf8',
        timeout: 2_000,
      },
    );

    expect(child.status, child.stderr).toBe(0);
  }
});

it('exchanges flat JSON values and replaces a socket without waiting for close', async () => {
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  const requests = [];
  sockets.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      requests.push(message);
      socket.send(JSON.stringify(message));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}`;
  const client = createRealtimeClient({
    createTransport: () =>
      new JsonTransport(new WebSocketAdapter({ url, WebSocket })),
    reconnect: { initialDelayMs: 10, maxDelayMs: 10 },
    random: () => 0.5,
  });
  const readies = [];
  const messages = [];
  client.onReady((info) => readies.push(info));
  client.onMessage((message) => messages.push(message));

  try {
    client.connect();
    await vi.waitFor(() => expect(readies).toHaveLength(1));
    const request = {
      id: 'r1',
      method: 'chat.send',
      params: { text: 'hello' },
    };
    expect(client.send(request)).toBe(true);
    await vi.waitFor(() => expect(messages).toEqual([request]));

    client.reconnect();
    await vi.waitFor(() => expect(readies).toHaveLength(2));
    expect(readies.map(({ reason }) => reason)).toEqual([
      'initial',
      'reconnect',
    ]);

    [...sockets.clients].at(-1).close();
    await vi.waitFor(() => expect(readies).toHaveLength(3));
    expect(messages).toEqual([request]);
    expect(requests).toEqual([request]);
  } finally {
    client.stop();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
