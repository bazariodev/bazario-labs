import type {
  Logger,
  Transport,
  TransportFactory,
  TransportHandlers,
} from '../index.js';
import { WebSocketAdapter } from '../index.js';

declare const handlers: TransportHandlers;
declare const logger: Logger;

const createTransport: TransportFactory = () =>
  new WebSocketAdapter({
    url: () => 'wss://example.com',
    protocols: ['bazario.realtime.v1'] as const,
    maxBufferedBytes: 1024,
    WebSocket,
    logger,
  });

const transport: Transport = createTransport();
transport.start(handlers);
const result: void = transport.send('hello');
transport.send(new Uint8Array([1]));
transport.close();
transport[Symbol.dispose]();
void result;

const adapter = new WebSocketAdapter({
  url: 'wss://example.com',
});
const adapterResult: void = adapter.send('hello');
const contract: Transport = adapter;
void adapterResult;
void contract;

// @ts-expect-error The concrete adapter also returns no acceptance flag.
const accepted: boolean = adapter.send('hello');
void accepted;

// @ts-expect-error A URL is required.
new WebSocketAdapter({});
// @ts-expect-error Reconnect is owned by the caller, not the transport adapter.
new WebSocketAdapter({ url: 'wss://example.com', reconnect: true });
// @ts-expect-error The adapter accepts transport messages, not objects.
new WebSocketAdapter({ url: 'wss://example.com' }).send({ hello: 'world' });
