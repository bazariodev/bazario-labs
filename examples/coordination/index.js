import assert from 'node:assert/strict';

import {
  AsyncExecutor,
  Emitter,
  Queue,
  SyncExecutor,
} from '@bazariodev/coordination';

const queue = new Queue();
queue.enqueue('first');
queue.enqueue('second');
assert.equal(queue.dequeue(), 'first');
assert.equal(queue.dequeue(), 'second');
assert.equal(queue.size, 0);

const sync = new SyncExecutor();
const syncOrder = [];
sync.enqueue(() => {
  syncOrder.push('outer');
  sync.enqueue(() => {
    syncOrder.push('nested-first');
    sync.enqueue(() => syncOrder.push('nested-last'));
  });
  sync.enqueue(() => syncOrder.push('nested-middle'));
});
assert.deepEqual(syncOrder, [
  'outer',
  'nested-first',
  'nested-middle',
  'nested-last',
]);

const asyncExecutor = new AsyncExecutor();
const asyncOrder = [];
const asyncResults = [
  asyncExecutor.enqueue(async () => {
    asyncOrder.push('first:start');
    await Promise.resolve();
    asyncOrder.push('first:end');
    return 1;
  }),
  asyncExecutor.enqueue(() => {
    asyncOrder.push('second');
    return 2;
  }),
];
assert.deepEqual(await Promise.all(asyncResults), [1, 2]);
assert.deepEqual(asyncOrder, ['first:start', 'first:end', 'second']);

const cancelExecutor = new AsyncExecutor();
let activeSignal;
let started;
const taskStarted = new Promise((resolve) => {
  started = resolve;
});
const activeResult = cancelExecutor.enqueue((signal) => {
  activeSignal = signal;
  started();
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
});
const pendingResult = cancelExecutor.enqueue(() => 'never runs');
const handleStop = (result) => result.catch((error) => error);
const settled = Promise.all([
  handleStop(activeResult),
  handleStop(pendingResult),
]);
await taskStarted;
cancelExecutor.stop();
const [activeError, pendingError] = await settled;
assert.equal(activeError, pendingError);
assert.equal(activeSignal.reason, pendingError);
assert.equal(pendingError.name, 'AbortError');

class ObservableValue {
  #events = new Emitter();
  value = 0;

  onChange(listener) {
    return this.#events.on('change', listener);
  }

  increment() {
    this.value += 1;
    this.#events.emit('change', this.value);
  }
}

const observable = new ObservableValue();
const observed = [];
const unsubscribe = observable.onChange((value) => observed.push(value));
observable.increment();
unsubscribe();
observable.increment();
assert.deepEqual(observed, [1]);

console.log('Coordination examples passed.');
