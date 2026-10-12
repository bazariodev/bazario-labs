import Coordination = require('@bazariodev/coordination');

const timer: Coordination.TimeoutScheduler = Coordination.defaultScheduler;
const options: Coordination.BackoffSchedulerOptions = {
  scheduler: timer,
  jitter: false,
};
const backoff: Coordination.BackoffScheduler =
  Coordination.createBackoffScheduler(options);
const cancelBackoff: () => void = backoff.schedule(1, () => undefined);
cancelBackoff();
const objectTimer: Coordination.TimeoutScheduler = {
  setTimeout: (callback) => ({ callback }),
  clearTimeout: (handle) => {
    if (typeof handle !== 'object' || handle === null) {
      throw new TypeError('Expected an object timer handle');
    }
  },
};
void objectTimer;
// @ts-expect-error random must return a number
Coordination.createBackoffScheduler({ jitter: { random: () => '0.5' } });

type Events = {
  ready: undefined;
  message: Readonly<{ text: string }>;
};

const emitter = new Coordination.Emitter<Events>();
emitter.emit('ready');
emitter.emit('message', { text: 'hello' });
const unsubscribe = emitter.on('message', (payload) => void payload.text);
unsubscribe();
// @ts-expect-error CommonJS on rejects unknown names
emitter.on('missing', () => undefined);
// @ts-expect-error CommonJS on links listener payload to the event name
emitter.on('message', (payload: number) => void payload);
// @ts-expect-error CommonJS declarations also reject missing payloads
emitter.emit('message');

const queue = new Coordination.Queue<string>();
queue.enqueue('hello');
const value: string | undefined = queue.dequeue();
void value;

const executor = new Coordination.AsyncExecutor();
const result: Promise<boolean> = executor.enqueue(() => true);
void result;
