# ADR: Coordination Primitives

- Status: Accepted
- Date: 2026-09-28
- Revised: 2026-10-12

## Context

Bazario needs reusable building blocks for ordered work and event-driven composition. The initial
idea grouped synchronous queues, asynchronous queues, and an event emitter into a utility package.
That mixes two responsibilities: storing items in order and deciding when to execute work.

A FIFO queue is useful for arbitrary values, regardless of whether a consumer executes them.
Synchronous execution needs predictable ordering when a task enqueues another task. Asynchronous
execution also needs to await completion and settle a result for each submitted task. Event delivery
is a separate concern: objects need to expose subscriptions without owning one another's behavior.

The first package consumers are [RealtimeClient](Realtime.md) and [RpcClient](Rpc.md). Realtime's
`onReady`, `onMessage`, and `onError` methods use a private Emitter. State snapshots retain their FSM
observation contract. Realtime needs neither an application send queue nor an executor for its
coalesced probes. `net-monitor` is a possible later emitter consumer, subject to its own ADR.

Existing implementations provide compatibility evidence:

- [HttpAdapter](../../../packages/transport/src/http-adapter.js) serializes POST requests through a
  promise chain, alongside transport-specific admission limits and terminal failure handling.
- [IdleWatchdog](../../../packages/idle-watchdog/src/idle-watchdog.js) and
  [Keepalive](../../../packages/keepalive/src/keepalive.js) each maintain listener registries.
- [Fsm](../../../packages/fsm/src/fsm.js) has specialized snapshot delivery: a nested transition
  suppresses delivery of the superseded snapshot to remaining subscribers.
- [FsmEffects](../../../packages/fsm-effects/src/fsm-effects.js) drains only the latest pending
  state, skipping superseded intermediate targets. Fsm and FsmHierarchy reject sends during their
  transition/reconciliation phases. None of these policies is a FIFO execution use case.

These are evidence for reusable mechanics, not proof that every existing implementation should be
replaced. Their observable behavior remains part of each package's contract.

Queue and the executors are intentional additions to the public SDK catalog, rather than mandatory
extractions from those consumers. They have no committed production adopter yet. Their first
validation is a standalone composition example; serial RTC/SIP operations are possible later uses,
not dependencies asserted by this ADR. This early public API commitment is a deliberate tradeoff.

## Decision

Introduce **`@bazariodev/coordination`** with four independently usable exports:

| Export | Responsibility |
| --- | --- |
| `Queue<T>` | Generic FIFO storage. |
| `SyncExecutor` | Ordered synchronous task execution, including reentrant submissions. |
| `AsyncExecutor` | Sequential task execution with a result promise per submission. |
| `Emitter<Events>` | Named, typed event subscriptions and synchronous delivery. |

Use one package with separate modules initially. The package name describes its scope: ordering
work and delivering events. General-purpose formatting, parsing, domain helpers, and other unrelated
utilities do not belong here.

The scope is local, in-process coordination. Distributed locks, leases, cross-tab leadership, and
protocol sequencing require separate designs. New exports require their own use case and design
review. The reviewed backoff export is limited to scheduling one callback per timer. It does not
add a queue or decide whether a retry is allowed. This exception does not admit advanced scheduling.

Implement runtime code in plain JavaScript, with public TypeScript declarations only. Follow the
workspace's ESM/CommonJS output and matching `.d.ts`/`.d.cts` declarations. Keep the package free of
runtime dependencies on other Bazario packages or third-party libraries.

The first public release is `1.0.0`. Treat its four public primitives as stable from that release.
The additive exports planned for `1.1.0` are also stable within the `1.x` line. Incompatible API
changes require a major version, with release notes and migration guidance.
Real-consumer use across normal, failure, and disposal paths remains valuable evidence; record it
in the adoption table below, but it is not a prerequisite for the initial stable release.

### Adoption evidence

Update this table with the actual consumer path or release and links to validation of its normal,
failure, and disposal paths. Planned integrations do not count as stability evidence.

| Export | Real consumer | Validation evidence | Validated in real use |
| --- | --- | --- | --- |
| `Emitter` | [RealtimeClient](../../../packages/realtime/src/realtime-client.js) and [RpcClient](../../../packages/rpc/src/rpc-client.js), implemented, release pending | Realtime and RPC public behavior tests cover subscriptions and disposal | Yes, in workspace |
| `Queue` | None committed | None yet | No |
| `SyncExecutor` | None committed | None yet | No |
| `AsyncExecutor` | None committed | None yet | No |
| `createJitter` | No runtime adopter | Coordination contract tests | No; tests only |
| `defaultScheduler` | [Realtime factory](../../../packages/realtime/src/realtime-factory.js), implemented, release pending | Coordination tests verify current-global forwarding; realtime tests cover native timer behavior | Yes, in workspace |
| `createBackoffScheduler` | [Realtime factory](../../../packages/realtime/src/realtime-factory.js), implemented, release pending | Backoff and factory tests cover delay policy, injection, cancellation, and failure | Yes, in workspace |

## Ownership and composition

```text
consumer ──enqueue(value)────────> Queue
consumer ──enqueue(task)─────────> SyncExecutor  ──owns──> private Queue
consumer ──enqueue(task)─────────> AsyncExecutor ──owns──> private Queue
subscriber ──onReady/onMessage──> owner ──on──> private Emitter
                                 owner ──emit/stop──> private Emitter
```

Each executor composes its own private queue. It controls admission, draining, failure, and disposal.
Consumers cannot mutate an executor's pending queue directly; removing an async task also requires
settling its result promise. The public `Queue` remains available for independent storage needs.

The executors do not inherit from `Queue` or require a shared executor base class. Queue injection
and interchangeable scheduling policies are deferred until a real consumer requires them.

The emitter is independent of both executors. Emitting an event does not implicitly enqueue work.
A consumer can explicitly enqueue a task from a listener when its workflow requires serialization.

## 1.0.0 contracts

The responsibility boundaries above are the architectural decision. The following behavior is the
initial implementation contract; any changes must update this ADR and the public-behavior tests.

### Queue

Expose `enqueue(value)`, `dequeue()`, `peek()`, a read-only `size`, and `clear()`.

- Values leave in the same order they entered. `peek()` does not remove the front value.
- Empty `dequeue()` and `peek()` return `undefined`. Stored `undefined` is permitted; consumers use
  `size` when they need to distinguish it from an empty queue.
- `clear()` removes stored values and leaves the queue reusable.
- Aim for amortized constant-time enqueue/dequeue and release references to removed values.
- The queue never invokes stored functions, awaits promises, schedules work, or emits events.

### SyncExecutor

Expose `enqueue(task): void`, `stop()`, and `[Symbol.dispose]()`.

- Construction is inert. Enqueuing into an idle executor starts draining synchronously.
- Tasks run in FIFO order. A task enqueued during execution is appended; it runs after the current
  task returns and after any tasks already waiting. A nested enqueue never starts a second drain.
- The outermost enqueue drains all available tasks before returning, unless a task fails or stops
  the executor. Nested enqueue returns after admission, before its task executes.
- Tasks must be synchronous. Returned values are ignored; asynchronous completion is outside this
  executor's contract. Work whose completion must be awaited belongs in `AsyncExecutor`.
- A thrown task error ends that drain, discards pending tasks, and is rethrown unchanged from the
  outermost enqueue. The executor releases its drain guard and remains reusable unless stopped.
- `stop()` is terminal and idempotent. It discards pending tasks; the current synchronous task
  finishes normally. Later enqueue calls throw a `DOMException` named `AbortError` without invoking
  the task. Disposal delegates to `stop()`.

There is no promise or per-task synchronous result API. A nested submission cannot return a result
that only becomes available after the current task finishes. An unbounded drain can block the
runtime; consumers own the amount of work they submit.

Failure ends the whole synchronous drain because its tasks can form a cascade over shared mutable
state that may now be partially updated. This is not a transaction: completed changes are not
rolled back, and successfully admitted nested tasks can be discarded without individual completion
notifications. The error reaches the outermost caller even if another callback submitted the
failing task. Consumers that need independent outcomes must use AsyncExecutor.

### AsyncExecutor

Expose `enqueue(task): Promise<Result>`, `stop()`, and `[Symbol.dispose]()`, where the task receives
a fresh `AbortSignal` scoped to that task: `task(signal)`.

- Accept a function that returns a value or promise, rather than an already-started promise.
- Enqueue schedules draining through a promise reaction. The task is not invoked inside the
  submitting call, and pending work runs automatically.
- Run one task at a time in FIFO order. Await its returned value or promise before invoking the
  next task. This is serial asynchronous execution; the initial release has no configurable concurrency.
- Each enqueue returns its own promise, fulfilled with the task's result or rejected with its
  original error. Synchronous task throws become promise rejections.
- A failed task rejects its submission and the next queued task runs unless the executor is stopped.
  Each submission has its own result, so one failure does not discard unrelated submissions.
  A consumer that needs terminal failure must call `stop()` inside its task before rethrowing;
  a later catch on the result promise is not a barrier against the next task starting.
- Create a fresh AbortController immediately before each task starts. Record it as active before
  invoking the task, and pass only that task's signal to the callback. On observed fulfillment or
  rejection, release the active controller before proceeding. Never abort that task's signal after
  its settlement has been observed, whether it succeeded or failed, or retain it for future stop
  calls. Tasks clean up their own resources and listeners on settlement or abort; separate signals
  prevent completed-task listeners from being retained and invoked by the executor's later stop.
- `stop()` is terminal and idempotent. Mark the executor stopped before aborting only the active
  task's controller, so reentrant abort listeners cannot admit or start new work. Create one
  `DOMException` named `AbortError` as the stop reason even when no task is active. Release the
  active controller before aborting it, then reject all pending submissions with the same reason
  and discard their tasks. Later enqueue calls return promises rejected with that reason.
- Cancellation is cooperative. An active task's result promise follows its own eventual settlement;
  a task that ignores the signal can still fulfill after stop. The executor does not race its result
  against cancellation or start another task while its effects might still be running. Disposal
  delegates to `stop()`. Caller-requested cancellation of individual tasks and deadlines remain
  outside the initial release; task-scoped controllers are internal lifetime isolation, not a public cancellation API.

Consumers must handle every returned promise, including pending submissions rejected by stop and
submissions made after stop. Attach a catch or an aggregate handler when submitting a batch, before
waiting for individual results. The executor does not install suppression handlers on public result
promises. Intentional fire-and-forget work must explicitly handle cancellation and report other
failures. AbortError identifies the cancellation category, not its source: a task can itself reject
with AbortError, and that error is preserved. Error message text is not a stable API.

Unlike silent event/timer disposal, rejecting a task reports that requested work will not run.
Late callers must invalidate their lifecycle callbacks or handle this rejection; synchronous late
callers must likewise guard admission or catch AbortError. Making enqueue inert would hide lost
work, and an unresolved async result would leave its consumer waiting indefinitely.

A task may enqueue later work, but must not await that work on the same executor: the later task
cannot start until the active task completes. The executor does not detect or resolve such cycles.
An active task that never settles blocks later work; deadlines remain a consumer responsibility.

### Emitter

Expose `on(type, listener): Unsubscribe`, `emit(type, payload): void`, `stop()`, and
`[Symbol.dispose]()`. Event names and payloads are related through the public event-map type.

An event map associates each string or symbol name with one payload type. Use `undefined` for an
event without a payload: for `{ ready: undefined; message: string }`, `emit('ready')` and
`emit('ready', undefined)` are valid, while `emit('message', text)` requires the string argument.
Listeners for `ready` receive `undefined` and can be zero-argument functions. Other payload types
require an argument, including unions that also admit `undefined`.

Both interfaces and type aliases must work as event maps, without an index signature. Derive event
names from the map's own string/symbol keys; do not require `Record<string | symbol, unknown>` or
widen a finite map into arbitrary names. Public declaration tests must cover both declaration forms.

The optional constructor option is `logger`, whose public shape is
`{ error(message: string, metadata: { type: string | symbol; error: unknown }): void }`.
Log each synchronous listener failure once with its event type and original error. The logger must
not throw; its default implementation is a no-op.

- Construction is inert. Listeners run synchronously, in registration order, with a snapshot of
  the listeners present when emission begins. Subscription changes affect subsequent emissions.
- Duplicate registration of the same function for the same event shares one subscription.
  Unsubscribe is idempotent and cannot remove a later registration of that function.
- Registering a non-function listener throws `TypeError` while the emitter is active.
- Nested emit calls deliver immediately using their own listener snapshot. The emitter does not
  silently impose FIFO execution. Explicitly choose an executor only for workflows that require
  every submitted task to run in FIFO order, subject to that executor's failure/stop rules.
- A synchronous listener failure is reported through an optional injected, non-throwing logger;
  other listeners still run. The default logger is a no-op. Async listeners handle their own
  rejections; `emit()` never awaits them.
- `stop()` clears subscriptions and prevents further delivery, including remaining listeners in
  every emission in progress. Later emits are inert; later subscriptions return a no-op unsubscribe
  function without retaining the listener. Disposal delegates to `stop()`.
- Events are not stored or replayed. There are no special event names with hidden behavior.

Make a class observable through composition: it owns a private emitter and exposes subscription
methods while retaining control over emission. Subscribers never receive the mutable emitter.
A bus-like owner can expose distinct publishing and subscription methods if its domain requires
multiple publishers; sharing an unrestricted emitter is not the default integration contract.
A global singleton or mandatory observable base class is not part of the package. State observation
still needs a snapshot accessor; events alone do not supply one.

Use the public class name `Emitter` to distinguish this small API from Node's `EventEmitter`.
The package README must state that `on()` returns an unsubscribe, duplicate listeners share
registration, `emit()` returns void, and `error` is an ordinary event name.

## Adoption boundaries

The emitter is used in RealtimeClient and RpcClient. One private emitter belongs to
the logical client, survives restartable disconnect/reconnect, and is disposed at terminal stop.
Realtime uses current-attempt identity and channel disposal to ignore stale events. Its public API
exposes `onReady`, `onMessage`, `onError`, `channel.subscribe`, and `channel.subscribeState`.
It does not expose `emit`.

Prove all four primitives with public-behavior tests and a runnable composition example. Refactoring
existing consumers is a separate task after compatibility review.

- Preserve FSM's post-commit, latest-snapshot delivery and reentrancy rules. The emitter's ordinary
  nested delivery is not a substitute for FSM-specific snapshot suppression.
- Preserve FsmEffects' latest-target drain and FsmHierarchy's reconciliation lock. A SyncExecutor
  would change both policies and is not planned as their replacement.
- Preserve IdleWatchdog's stop-during-notification behavior and Keepalive's guaranteed terminal
  failure delivery. Keepalive currently delivers a captured listener set after becoming stopped;
  that needs owner-controlled delivery rather than blindly stopping a shared emitter first.
- Keep HttpAdapter's byte admission limits, stop guards, and terminal failure policy with the
  adapter. An executor's continue-after-failure behavior cannot replace those decisions.
- Keep reconnect, replay, durable outboxes, retries, and protocol policy with their current owners.
  In particular, the [Realtime ADR](Realtime.md) still excludes an application outbound queue.
- Existing dependency-free packages do not automatically acquire a coordination dependency.
  Adopt a primitive only when the simplification justifies the dependency and preserves behavior.

## Scope

The initial release covers FIFO storage, synchronous draining, serial asynchronous execution, synchronous event
delivery, deterministic failure behavior, unsubscribe ownership, and terminal executor/emitter
disposal.

Outside this decision: advanced scheduling such as cron, priority queues, and persistent jobs;
persistence/replay, reactive streams, framework bindings, and distributed or cross-tab coordination.
Cancellation and deadlines for individual executor submissions remain deferred. The backoff
addendum permits cancellation of each scheduled callback without changing executor contracts.
These exclusions are not promises of later exports in this package.

## Validation

Test observable behavior and public declarations rather than private queue representation:

- Queue: FIFO ordering, empty behavior, stored `undefined`, peek, size, clear, and reuse.
- SyncExecutor: FIFO including nested enqueue, no recursive drain, synchronous outer completion,
  thrown-error propagation to the outermost caller, discarding pending work on failure, recovery,
  stop during a task, repeated stop/disposal, and AbortError on post-stop submission.
- AsyncExecutor: lazy invocation, one active task, FIFO after settlement, independent result
  promises, synchronous throws, rejected tasks followed by successful tasks, and stop before or
  during execution. Every discarded pending submission must reject; an active result must retain
  its eventual settlement, and stopped executors must never restart from a late callback. Verify
  AbortError for pending/post-stop work, distinct signals for successive tasks, and no stop-triggered
  abort after observed fulfillment or rejection of a task. Cover abort-aware and abort-ignoring active
  tasks, stop with no active task, shared stop-reason identity, reentrant admission from an abort
  listener, and repeated stop/disposal. Attach handlers at submission in normal tests;
  isolated-process tests verify that discarded public result promises
  retain ordinary unhandled-rejection behavior for both cancellation and task failure.
- Emitter: registration order, listener snapshots, nested emission order, duplicate ownership,
  stale unsubscribe safety, logger metadata, failure isolation, no replay, ordinary `error` events,
  stop during nested delivery, repeated disposal, and inert post-stop emit/on/unsubscribe.
- Backoff: capped exponential delay, ratio jitter, disabled/equal-ratio draw behavior, provider
  forwarding, independent cancellation, asynchronous zero delay, invalid options, and callback
  reentry. Cover accepted bounds, exact error identity, and random calls without a receiver.
  Verify `defaultScheduler` forwards to the current global timer functions.
- Types: queue item types, inferred async task results, event-name/payload relationships, and
  unsubscribe signatures through ESM and CommonJS consumer imports. Cover payload-free events,
  required payloads, interface and type-alias maps without index signatures (including symbol keys),
  rejection of unknown event names/wrong payloads, and AbortSignal in DOM and WebWorker checks.
- Example: implement the workspace example described below, with assertions for direct FIFO storage,
  synchronous reentrant work, serial asynchronous work with handled cancellation, and an
  event-driven class that keeps emission private. The workspace example now exists.
- Package README: include a standalone handled-stop example that installs rejection handlers when
  submitting work, handles AbortError for discarded work, reports other failures, and awaits all
  results. npm readers must not need the repository example to learn safe disposal.
- Realtime integration: public subscription wrappers, subscriptions surviving reconnect, private
  emission, exception isolation, and suppression of stale events and post-stop delivery.

Run focused tests, the workspace build, public-interface typechecks, and the full health gate when
the package is implemented. Any later consumer migration also needs its existing contract tests.

### Workspace example and health integration

Create `examples/coordination/index.js`, its README, and this manifest when implementing the package:

```json
{
  "name": "@bazariodev/example-coordination",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node index.js"
  },
  "dependencies": {
    "@bazariodev/coordination": "workspace:^"
  }
}
```

Keep this private example manifest without a `version` field. With this workspace's Changesets
configuration, that intentionally excludes the example from versioning and changelog generation;
`private: true` alone does not. Adding a version would enroll it in dependent version updates.

`pnpm-workspace.yaml` includes `examples/*` so pnpm links the published package entry point locally.
Add this manifest together with the real coordination package, then update `pnpm-lock.yaml`; do not
leave a workspace dependency pointing to a nonexistent package. Use Node assertions in `index.js`
so a broken example exits nonzero. Document running `pnpm build` followed by
`pnpm --filter @bazariodev/example-coordination test` from the repository root.

The root `pnpm test` and `pnpm health` build packages before recursively running test scripts, so
the example participates through its `test` script. CI's node_modules cache includes
`examples/*/node_modules` along with package dependencies for the separate test job. The initial
package implementation must prove the example runs both directly and through the root health gate.

## Alternatives considered

- **Native EventTarget.** A viable primitive with synchronous dispatch and signal-based removal.
  It would still need wrappers for typed payload maps, unsubscribe handles, and injected listener
  error reporting. Its removal-during-dispatch semantics also differ from our listener snapshot
  contract. Direct listener storage keeps that small contract explicit. See the
  [DOM dispatch rules](https://dom.spec.whatwg.org/#concept-event-listener-invoke) and
  [Node EventTarget error handling](https://nodejs.org/api/events.html#eventtarget-error-handling).
- **A local promise chain.** Suitable for owners such as HttpAdapter, which already own admission,
  terminal failure, and cancellation. A chain can provide individual task results, but removing
  unstarted work and rejecting it promptly at stop requires additional bookkeeping. Keep the local
  idiom where sufficient; AsyncExecutor packages that bookkeeping for independent consumers.
- **SyncQueue and AsyncQueue that store and execute.** Rejected: storage and execution should be
  independently reusable and have different lifecycle contracts.
- **One executor with a sync/async flag.** Rejected: synchronous completion and promise settlement
  have different return and error behavior. Separate APIs make the choice explicit.
- **Executors inherit from Queue or expose their queue.** Rejected: direct mutation bypasses task
  settlement and lifecycle ownership.
- **Separate npm packages immediately.** Deferred: the four small modules can be independently
  imported through one side-effect-free package. Small packages are valid in this workspace; this
  grouping is a delivery choice, with the acknowledged cost of a shared version/release boundary.
  Split if actual consumers or independent release needs justify it.
- **Keep backoff scheduling inside Realtime.** Rejected: it would tie timer and delay mechanics to
  one consumer. The roadmap names `fsm-retry` as a planned second consumer. Coordination provides
  the small reusable operation; Realtime retains attempts and retry policy.
- **Put the backoff operation in `fsm-retry`.** Deferred: that planned package can build a
  declarative retry policy on `createBackoffScheduler`. The one-shot utility does not need FSM
  policy or state.
- **Create a separate backoff package.** Rejected for this release: the utility has one current
  runtime consumer and no independent release need. A separate package would add a release boundary
  for the timer provider and one-callback scheduler.
- **Emitter-only scope; remove public Queue and SyncExecutor.** Rejected for this plan: standalone
  storage and both execution modes are requested SDK capabilities. Lack of a current production
  adopter is documented as a risk; it does not make their separation invalid. Build the emitter
  first for the known near-term consumer and demonstrate the other primitives independently.
- **Rename AsyncExecutor to SerialQueue or Mutex.** Rejected: keep the agreed storage/execution
  distinction in the API names. Document serial execution explicitly; this is not a lock API.
- **Use EventEmitter as the public class name.** Rejected before publication: Emitter keeps the
  purpose clear while avoiding a collision and implied compatibility with Node's familiar API.
- **Rename the coordination package.** Not required: its local scope and four exports are explicit.
  Retain the package name; cross-tab leadership and distributed locking need their own designs.
- **Internally suppress cancellation rejections.** Rejected: owners must observe unsuccessful task
  submissions consistently, including calls after disposal. Consumers can intentionally handle
  cancellation; the executor must not silently hide ignored results on their behalf.
- **A general utils package.** Rejected: it gives unrelated helpers no clear admission boundary.
- **Migrate all subscriptions immediately.** Rejected: existing owners have distinct notification
  contracts and dependency boundaries.

## Consequences and delivery order

The package supplies shared mechanics while consumers retain workflow policy. The cost is a new
public contract to maintain, plus explicit decisions about failure, nested calls, and disposal.

Implement in this order: `Emitter`, `Queue`, `SyncExecutor`, then `AsyncExecutor`. Validate the
package and `examples/coordination/`, document its consumer API, and prepare its first release.
Then integrate the emitter while implementing RealtimeClient. The [roadmap](../../ROADMAP.md)
places this work first within the existing R2 connectivity milestone. Later tasks move down in
priority; shipped milestone labels and R1–R5 numbering remain unchanged.


## Addendum: bounded jitter (2026-10-10)

`createJitter({ minMs, maxMs, random? })` is a fifth independent export. It returns a function
that draws uniformly distributed integer milliseconds between inclusive bounds. Bounds are ordered
integers in `[1, 2_147_483_647]`; injected randomness must yield a finite value in `[0, 1)`.
Rejecting zero at construction keeps every draw compatible with the watchdog's positive idle durations.
Equal bounds skip randomness. Construction draws nothing. The helper owns no timers, retries, or
lifecycle. It remains a timer-free duration helper.

`createJitter` has no runtime adopter. Its public contract tests cover its bounds and draws. An
application can supply its returned duration function as Keepalive's `idleMs`; that is a possible
composition, not a current consumer. IdleWatchdog validates each duration when it arms. A pending
response retains its fixed deadline. Keepalive and IdleWatchdog do not acquire a coordination
dependency. Fixed timing remains the default.

RealtimeClient and RpcClient now use private Emitters in the implemented workspace packages.

## Addendum: shared backoff scheduling (2026-10-12)

Realtime's retry driver needs delay calculation and cancellable callback scheduling. These
operations do not need a transport or FSM. The reviewed extraction puts these reusable mechanics
in coordination while the realtime lifecycle owns failure counts and retry decisions.

Coordination now exports `defaultScheduler` and `createBackoffScheduler(options)`. The default
provider forwards timer calls to the current platform globals and stores no jobs. Its
handles are opaque. Each backoff call accepts a one-based attempt owned by its caller, creates an
independent timer, and returns idempotent cancellation. A zero delay remains asynchronous.

The default delay uses a 500 ms initial value, factor 2, a 30,000 ms cap, and full jitter with ratios
in `[0, 1)`. The capped exponential base is multiplied by the selected finite ratio, rounded down,
and capped again. `jitter: false` uses the base delay and makes no random draw. Ordered finite,
nonnegative ratios may exceed 1; equal ratios also skip the random source. An injected source must
return a finite number in `[0, 1)` and is called without a receiver. The scheduler validates delay
options before it schedules work and leaves attempt counting, reset policy, and workflow ownership
to the caller.

Realtime's root factory shares one provider across its connection deadline, default backoff, and
default Keepalive. Its top-level `random` remains the fallback for default backoff; a configured
`reconnect.jitter.random` takes precedence, and `jitter: false` skips draws. Custom retry drivers
and `retry: null` do not use the default backoff options. Direct RealtimeClient core construction
keeps its native timer fallback. Standalone IdleWatchdog remains independent of coordination.

Realtime's unreleased workspace `createRetry` helper moved to coordination under the name
`createBackoffScheduler`. This describes an internal workspace change, not a migration from a
published API. The helper schedules one callback; it does not count attempts or decide whether a
retry is allowed.
