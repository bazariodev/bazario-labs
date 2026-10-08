import Coordination = require('@bazariodev/coordination');

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
