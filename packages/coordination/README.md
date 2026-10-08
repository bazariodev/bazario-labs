# @bazariodev/coordination

Small in-process building blocks for FIFO storage, synchronous and asynchronous task execution, and
typed events. A `Queue` only stores values; executors own a private queue and decide when tasks run.

## Install

```sh
pnpm add @bazariodev/coordination
```

The package has no runtime dependencies.

## Usage

Keep event publication inside the class that owns the event source:

```js
import { Emitter } from '@bazariodev/coordination';

class Counter {
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

const counter = new Counter();
const unsubscribe = counter.onChange((value) => console.log(value));
counter.increment(); // 1
unsubscribe();
```

`Counter` owns the `Emitter`; callers receive only a subscription method.

`Queue` stores values without running them:

```js
import { Queue } from '@bazariodev/coordination';

const queue = new Queue();
const work = () => console.log('run only when called');
queue.enqueue(work);
console.log(queue.size); // 1
const next = queue.dequeue();
next();
```

`SyncExecutor` runs tasks immediately. A task submitted during another task runs after the current
task returns:

```js
import { SyncExecutor } from '@bazariodev/coordination';

const executor = new SyncExecutor();
executor.enqueue(() => {
  console.log('first');
  executor.enqueue(() => console.log('third'));
  console.log('second');
});
// first, second, third

executor.stop();

const terminal = new SyncExecutor();
try {
  terminal.enqueue(() => {
    terminal.stop(); // discard any work queued by this task
    throw new Error('fatal task failure');
  });
} catch (error) {
  console.error(error); // the original task error
}
```

## Behavior

- `Queue` stores any value, including `undefined`, in FIFO order. It never calls or schedules values.
- `SyncExecutor` drains immediately. Nested tasks join the end of the current drain. A task error
  clears pending work and is rethrown; the executor can be reused unless it was stopped.
- SyncExecutor tasks must finish synchronously. An async callback returns before its work finishes;
  the executor cannot await or handle its rejection. For terminal failure, call `stop()` inside the
  task before throwing, so queued work is discarded.
- `AsyncExecutor` starts in a promise reaction and runs one task at a time. Each submission gets its
  own result promise and a fresh task-scoped `AbortSignal`. A failed task does not prevent later work.
- An async task must not await work it submitted to the same executor: that later work cannot start
  until the current task settles. A task that never settles blocks all later work.
- For terminal async failure, call `stop()` inside the task before throwing. Catching the task's
  result later does not prevent the next task from starting.
- Stopping either executor is terminal. SyncExecutor throws `AbortError` on later submission.
  AsyncExecutor rejects pending and later submissions with one shared `AbortError`; an active task
  is signalled and its result follows its own eventual settlement.
- `Emitter` calls listeners synchronously in registration order from a snapshot. Nested emits deliver
  immediately. Duplicate registration of the same function shares one unsubscribe handle.
- `Emitter.emit()` returns `void`. `error` is an ordinary event name with no hidden behavior.
- `Emitter.on()` returns an idempotent unsubscribe function. Events are not replayed to late subscribers.
- Emitter listener failures are reported once through the optional logger; later listeners still run.
  Async listener rejections belong to the listener. Stop prevents remaining callbacks in active
  emission frames and makes later emits and subscriptions inert.
- `[Symbol.dispose]()` delegates to `stop()` for executors and Emitter.

## API

| Export | Main methods |
| --- | --- |
| `Queue<Value>` | `enqueue(value)`, `dequeue()`, `peek()`, `size`, `clear()` |
| `SyncExecutor` | `enqueue(task)`, `stop()`, `[Symbol.dispose]()` |
| `AsyncExecutor` | `enqueue(task)`, `stop()`, `[Symbol.dispose]()` |
| `Emitter<Events>` | `on(type, listener)`, `emit(type, payload)`, `stop()`, `[Symbol.dispose]()` |

| Emitter option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `logger` | `{ error(message, { type, error }): void }` | No-op | Receives synchronous listener failures; must not throw. |

An empty Queue returns `undefined` from `dequeue()` and `peek()`; use `size` to distinguish that from
a stored `undefined`. `SyncExecutor.enqueue()` returns `void`; `AsyncExecutor.enqueue()` returns
the task's result promise. Both executors reject non-function tasks (`AsyncExecutor` returns a rejected
promise). Construct an Emitter with `new Emitter({ logger })` when listener failures need reporting.

Async task results, including cancellation, must be handled. Attach handlers when submitting work:

```js
import { AsyncExecutor } from '@bazariodev/coordination';

const executor = new AsyncExecutor();
let notifyStarted;
const started = new Promise((resolve) => {
  notifyStarted = resolve;
});

const active = executor.enqueue((signal) => {
  notifyStarted();
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
});
const pending = executor.enqueue(() => 'later');
const outcomes = Promise.allSettled([active, pending]);

await started;
executor.stop();
for (const outcome of await outcomes) {
  if (outcome.status === 'rejected' && outcome.reason?.name !== 'AbortError') {
    console.error('Task failed', outcome.reason);
  }
}
```

The started task rejects when aborted, and the queued task rejects without running. `Promise.allSettled`
handles both outcomes and lets the application report every non-cancellation failure. A task that
ignores its signal may still fulfill after stop.

## Errors

| Situation | Result |
| --- | --- |
| Sync task throws | Pending drain is cleared; the same error is thrown from the outer enqueue. |
| Async task throws or rejects | That submission rejects with the original error; draining continues. |
| Submit after SyncExecutor stops | Throws a `DOMException` named `AbortError`. |
| Pending or later async submission after stop | Rejects with the executor's shared `AbortError`. |
| Emitter listener throws | The logger receives its event type and original error; delivery continues. |
| Submit a non-function SyncExecutor task | Throws `TypeError`. |
| Submit a non-function AsyncExecutor task | Returns a promise rejected with `TypeError`. |
| Register a non-function Emitter listener while active | Throws `TypeError`. |

## TypeScript

`Emitter<Events>` accepts interfaces and type aliases with string or symbol keys; event names and
payloads stay linked without an index signature. Use `undefined` for payload-free events. A payload
type such as `string | undefined` still requires an argument. `AsyncExecutor` passes a DOM
`AbortSignal`; include the `DOM` or `WebWorker` library in your TypeScript configuration. The
package ships ESM and CommonJS with matching declarations.

For TypeScript, give the emitter an event map:

```ts
import { Emitter } from '@bazariodev/coordination';

const events = new Emitter<{ change: number; ready: undefined }>();
const unsubscribe = events.on('change', (value) => console.log(value));
events.emit('change', 1);
events.emit('ready');
unsubscribe();
```

In a JavaScript file checked by TypeScript, annotate the event map with JSDoc:

```js
import { Emitter } from '@bazariodev/coordination';

/** @type {import('@bazariodev/coordination').Emitter<{ change: number }>} */
const events = new Emitter();
```

## License

MIT
