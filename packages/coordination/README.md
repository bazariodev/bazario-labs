# @bazariodev/coordination

Small in-process building blocks for FIFO storage, synchronous and asynchronous task execution,
typed events, jitter, and timer scheduling. A `Queue` only stores values; executors own a private
queue and decide when tasks run.

## Install

```sh
pnpm add @bazariodev/coordination
```

The package has no runtime dependencies and requires Node.js 22 or newer in Node environments.

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

## Jitter without timers

```js
import { createJitter } from '@bazariodev/coordination';

const nextIdleMs = createJitter({ minMs: 40_000, maxMs: 60_000 });
const delayMs = nextIdleMs(); // An integer within the inclusive range.
```

Inject `nextIdleMs` into Keepalive or IdleWatchdog's `idleMs` option. The function owns no
clock, timer, retry counter, or lifecycle. Every draw uses `random` (default `Math.random`),
except equal bounds return their fixed value without sampling. Tests can inject `random: () => 0.5`.
Bounds must be ordered integers in `[1, 2_147_483_647]`; zero is rejected at construction so every
draw is a valid positive idle duration. Random results must be finite numbers in `[0, 1)`.

## Backoff scheduling

Use `createBackoffScheduler` when the application owns the retry count and decides when to stop or
reset retries:

```js
import { createBackoffScheduler } from '@bazariodev/coordination';

const backoff = createBackoffScheduler({
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: { minRatio: 0.25, maxRatio: 1 },
});

const onRetry = () => console.log('Retry is due');
const failedAttempts = 1; // The application owns this count.
const cancel = backoff.schedule(failedAttempts, onRetry);
cancel(); // Cancel this callback if connection intent changes.
```

`defaultScheduler` forwards timer calls to the current global functions. It has no pending-job
state. Timer handles are opaque to callers. The default provider runs a zero-delay callback later,
not during `schedule()`.

Each `schedule(attempt, callback)` call owns one timer and returns its idempotent cancellation
function. Attempts are positive integers starting at one. The caller increments and resets the
attempt count. The scheduler does not start a connection, count failures, or choose a lifecycle.

The default delay is `min(30_000, 500 * 2 ** (attempt - 1))`, with a random ratio in `[0, 1)`. The
base is capped before jitter. `jitter: false` uses the base delay and makes no random draw. A
configured ratio is sampled between `minRatio` and `maxRatio`; the result is multiplied by the
capped base, rounded down, then capped at `maxDelayMs`. Ratios must be finite, nonnegative, and
ordered. Ratios can be greater than 1. Equal ratios skip randomness. A random function is called
without a receiver and must return a finite value in `[0, 1)`.

`initialDelayMs` and `maxDelayMs` must be positive integers no greater than `2_147_483_647`, and
`maxDelayMs` must be at least `initialDelayMs`. `factor` must be finite and at least 1. Construction
does not schedule work or draw randomness. Provider errors reach the caller.

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
| `createJitter({ minMs, maxMs, random? })` | Returns a `() => number` duration function. |
| `defaultScheduler` | Stateless `setTimeout` and `clearTimeout` provider. |
| `createBackoffScheduler(options?)` | Returns `schedule(attempt, callback)`, which returns cancellation. |
| `Queue<Value>` | `enqueue(value)`, `dequeue()`, `peek()`, `size`, `clear()` |
| `SyncExecutor` | `enqueue(task)`, `stop()`, `[Symbol.dispose]()` |
| `AsyncExecutor` | `enqueue(task)`, `stop()`, `[Symbol.dispose]()` |
| `Emitter<Events>` | `on(type, listener)`, `emit(type, payload)`, `stop()`, `[Symbol.dispose]()` |

| Emitter option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `logger` | `{ error(message, { type, error }): void }` | No-op | Receives synchronous listener failures; must not throw. |

| Backoff option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `initialDelayMs` | positive integer | `500` | First capped exponential delay. |
| `maxDelayMs` | positive integer | `30_000` | Cap for the base and final jittered delay. |
| `factor` | finite number >= 1 | `2` | Growth per one-based attempt. |
| `scheduler` | `TimeoutScheduler` | `defaultScheduler` | Supplies timer calls; handles stay opaque. |
| `jitter` | ratio options or `false` | full jitter, `[0, 1)` | `false` skips random draws; equal ratios also skip draws. |

The `TimeoutScheduler` methods are `setTimeout(callback, delayMs)` and `clearTimeout(handle)`. The
handle type is `unknown`; pass it back to the same provider when you clear the timer.
`BackoffJitterOptions` accepts finite, ordered,
nonnegative `minRatio` and `maxRatio` values, plus an optional `random()` function. The default range
uses bounds 0 and 1; ratios above 1 are allowed and the final delay stays capped. Set `jitter` to
`false` to disable it.

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
| Invalid jitter bounds / random result | Throws `RangeError` at construction / draw respectively. |
| Non-function jitter random source | Throws `TypeError` at construction. |
| Invalid backoff delay, factor, ratio, or random result | Throws `RangeError` during construction / scheduling. |
| Invalid timer provider or random source | Throws `TypeError` during construction. |
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
