// @ts-expect-error internal helper types are not public exports
import type { EventKey } from '@bazariodev/coordination';
import {
  AsyncExecutor,
  createJitter,
  type Emitter,
  Queue,
} from '@bazariodev/coordination';

const draw: () => number = createJitter({ minMs: 40_000, maxMs: 60_000 });
void draw;
// @ts-expect-error maximum is required
createJitter({ minMs: 100 });
// @ts-expect-error randomness returns a number
createJitter({ minMs: 1, maxMs: 2, random: () => '0.5' });

void (null as unknown as EventKey<object>);

declare const eventSymbol: unique symbol;

interface InterfaceEvents {
  ready: undefined;
  message: string;
  optional: string | undefined;
  [eventSymbol]: Readonly<{ id: number }>;
}

type AliasEvents = {
  saved: Readonly<{ id: number }>;
};

declare const emitter: Emitter<InterfaceEvents>;
declare const aliasEmitter: Emitter<AliasEvents>;
declare const impossibleEmitter: Emitter<{ impossible: never }>;
const unsubscribe: () => void = emitter.on('ready', () => undefined);
unsubscribe();

emitter.emit('ready');
emitter.emit('ready', undefined);
emitter.emit('message', 'hello');
emitter.emit('optional', undefined);
emitter.emit(eventSymbol, { id: 1 });
aliasEmitter.emit('saved', { id: 2 });
// @ts-expect-error a never payload cannot be omitted
impossibleEmitter.emit('impossible');

// @ts-expect-error message needs its string payload
emitter.emit('message');
// @ts-expect-error unions containing undefined still require an argument
emitter.emit('optional');
// @ts-expect-error unknown event names are rejected
emitter.emit('missing', 1);
// @ts-expect-error the event payload must match the event map
emitter.emit('message', 1);
// @ts-expect-error symbol event payload must match the event map
emitter.emit(eventSymbol, { id: 'wrong' });

const queue = new Queue<number>();
queue.enqueue(1);
const numberOrUndefined: number | undefined = queue.dequeue();
void numberOrUndefined;
// @ts-expect-error Queue values remain typed
queue.enqueue('one');

const executor = new AsyncExecutor();
const result: Promise<number> = executor.enqueue(async (signal) => {
  signal.throwIfAborted();
  return 1;
});
void result;

declare const payloadListener: (payload: string) => void;
emitter.on('message', payloadListener);
// @ts-expect-error on rejects unknown event names
emitter.on('missing', () => undefined);
// @ts-expect-error on links listener payload to the event name
emitter.on('message', (payload: number) => void payload);

class GenericOwner<Message> {
  readonly events = null as unknown as Emitter<{ message: Message }>;

  publish(message: Message) {
    this.events.emit('message', message);
    return this.events.on('message', (payload) => void payload);
  }
}
void GenericOwner;

declare const flag: boolean;
const unionResult: Promise<number | string> = executor.enqueue(() =>
  flag ? Promise.resolve(1) : Promise.resolve('a'),
);
void unionResult;

const explicitResult: Promise<number> = executor.enqueue<number>(async () => 1);
void explicitResult;
