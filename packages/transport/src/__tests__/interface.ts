import type {
  Logger,
  Transport,
  TransportClose,
  TransportFactory,
  TransportHandlers,
  TransportMessage,
} from '../index.js';

declare const transport: Transport;
declare const handlers: TransportHandlers;

const logger: Logger = {
  debug(message, meta) {
    const text: string = message;
    const details: unknown = meta;
    void text;
    void details;
  },
  warn() {},
  error() {},
};
logger.debug('Starting');
logger.error('Failed', new Error('Connection failed'));
const consoleLogger: Logger = console;
void consoleLogger;

// @ts-expect-error Logger messages must be strings.
logger.debug(123);
// @ts-expect-error All logger levels are required.
const partialLogger: Logger = { error() {} };
void partialLogger;

const createTransport: TransportFactory = () => transport;
const attempt = createTransport();
attempt.start(handlers);
const result: void = attempt.send('hello');
attempt.send(new Uint8Array([1, 2]));
attempt.close();
attempt[Symbol.dispose]();

const message: TransportMessage = new Uint8Array([3]);
const close: TransportClose = { clean: false };
handlers.onOpen();
handlers.onMessage(message);
handlers.onError(new Error('connection failed'));
handlers.onClose(close);
void result;

// @ts-expect-error send returns no acceptance flag; rejected writes throw.
const accepted: boolean = attempt.send('hello');
void accepted;

// @ts-expect-error Transport messages are text or byte arrays, not JSON objects.
attempt.send({ type: 'message' });
// @ts-expect-error Raw ArrayBuffer is not part of the transport message contract.
attempt.send(new ArrayBuffer(1));
// @ts-expect-error All four lifecycle handlers are required.
attempt.start({ onOpen() {} });
// @ts-expect-error Every close event reports whether it was clean.
handlers.onClose({ code: 1000 });
