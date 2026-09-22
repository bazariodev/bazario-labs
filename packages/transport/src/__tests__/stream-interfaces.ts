import type {
  HttpAdapterOptions,
  Logger,
  Transport,
  TransportFactory,
  TransportHandlers,
  WebTransportAdapterOptions,
} from '../index.js';
import { HttpAdapter, WebTransportAdapter } from '../index.js';

declare const handlers: TransportHandlers;
declare const logger: Logger;

const httpOptions: HttpAdapterOptions = {
  url: () => 'https://example.com/attempt-1',
  headers: { Authorization: 'Bearer token' },
  credentials: 'include',
  maxMessageBytes: 1024,
  maxBufferedBytes: 2048,
  fetch: (url, init) => fetch(url, init),
  logger,
};
const webTransportOptions: WebTransportAdapterOptions = {
  url: 'https://example.com/realtime',
  sessionOptions: { congestionControl: 'low-latency' },
  maxMessageBytes: 1024,
  maxBufferedBytes: 2048,
  WebTransport,
  logger,
};

const factories: TransportFactory[] = [
  () => new HttpAdapter(httpOptions),
  () => new WebTransportAdapter(webTransportOptions),
];
const transports: Transport[] = [
  new HttpAdapter(httpOptions),
  new WebTransportAdapter(webTransportOptions),
  ...factories.map((create) => create()),
];
for (const transport of transports) {
  transport.start(handlers);
  const result: void = transport.send('hello');
  transport.send(new Uint8Array([1, 2]));
  transport.close();
  transport[Symbol.dispose]();
  void result;
}

const http: HttpAdapter = new HttpAdapter(httpOptions);
const webTransport: WebTransportAdapter = new WebTransportAdapter(
  webTransportOptions,
);
const httpResult: void = http.send('hello');
const webTransportResult: void = webTransport.send('hello');
void httpResult;
void webTransportResult;

// @ts-expect-error HTTP writes do not return an acceptance flag.
const accepted: boolean = http.send('hello');
void accepted;
// @ts-expect-error WebTransport accepts text or bytes, not application objects.
webTransport.send({ message: 'hello' });
// @ts-expect-error The URL is required.
new HttpAdapter({});
// @ts-expect-error The URL is required.
new WebTransportAdapter({});
// @ts-expect-error HTTP connection timeouts belong to the connection owner.
new HttpAdapter({ url: 'https://example.com', connectTimeoutMs: 1000 });
new WebTransportAdapter({
  url: 'https://example.com',
  // @ts-expect-error Native WebTransport options have no HTTP credentials field.
  sessionOptions: { credentials: 'include' },
});
