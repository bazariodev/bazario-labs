const DEFAULT_SCHEDULER = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

const MAX_TIMER_MS = 2_147_483_647;
const NOOP = () => {};

export class RealtimeClient {
  #fsm;
  #events;
  #createTransport;
  #retry;
  #createKeepalive;
  #scheduler;
  #connectTimeoutMs;
  #logger;
  #connectivity;
  #connectivityUnsubscribe = null;
  #connectivityState = 'online';
  #suspended = false;
  #retrylessFailed = false;
  #clientSnapshot;
  #clientRawSnapshot;
  #unsubscribe = null;
  #stateSubscriptions = new WeakMap();
  #attempt = null;
  #retryRecord = null;
  #operation = 0;
  #desired = false;
  #wasReady = false;
  #stopped = false;

  constructor(deps) {
    assertDeps(deps);
    this.#fsm = deps.fsm;
    this.#events = deps.events;
    this.#createTransport = deps.createTransport;
    this.#retry = deps.retry ?? null;
    this.#createKeepalive = deps.createKeepalive ?? null;
    this.#scheduler = deps.scheduler ?? DEFAULT_SCHEDULER;
    this.#connectTimeoutMs = deps.connectTimeoutMs;
    this.#logger = deps.logger;
    this.#connectivity = deps.connectivity ?? null;
    this.#clientRawSnapshot = this.#fsm.snapshot;
    this.#clientSnapshot = this.#connectivity
      ? Object.freeze({
          ...this.#fsm.snapshot,
          connectivity: 'online',
          suspended: false,
        })
      : this.#fsm.snapshot;

    try {
      this.#unsubscribe = this.#fsm.subscribe((snapshot) =>
        this.#onSnapshot(snapshot),
      );
      if (typeof this.#unsubscribe !== 'function')
        throw new TypeError(
          'fsm.subscribe must return an unsubscribe function',
        );
      if (this.#connectivity) {
        assertConnectivitySource(this.#connectivity);
        const unsubscribe = this.#connectivity.subscribe((state) =>
          this.#onConnectivity(state),
        );
        if (typeof unsubscribe !== 'function')
          throw new TypeError(
            'connectivity.subscribe must return an unsubscribe function',
          );
        this.#connectivityUnsubscribe = unsubscribe;
        const state = this.#connectivity.getSnapshot();
        if (!isConnectivityState(state))
          throw new TypeError(
            'connectivity.getSnapshot returned an invalid state',
          );
        this.#onConnectivity(state);
      }
    } catch (cause) {
      this.#safeCleanup(
        this.#connectivityUnsubscribe,
        'connectivity unsubscribe',
      );
      this.#connectivityUnsubscribe = null;
      this.#safeCleanup(this.#unsubscribe, 'fsm unsubscribe');
      this.#unsubscribe = null;
      this.#safeCleanup(() => this.#events.stop(), 'events stop');
      throw cause;
    }
  }

  get snapshot() {
    return this.#connectivity ? this.#clientSnapshot : this.#fsm.snapshot;
  }

  get state() {
    return this.#fsm.state;
  }

  connect() {
    if (this.#stopped || this.state !== 'idle') return;
    if (this.#connectivity && this.#connectivityState === 'offline') {
      this.#desired = true;
      this.#suspended = true;
      this.#refreshSnapshot();
      return;
    }
    if (this.#desired && !this.#retrylessFailed) return;
    const operation = ++this.#operation;
    this.#desired = true;
    this.#suspended = false;
    this.#retrylessFailed = false;
    if (!this.#isCurrentOperation(operation)) return;
    this.#fsm.send({ type: 'CONNECT' });
  }

  reconnect() {
    if (this.#stopped) return;
    const operation = ++this.#operation;
    this.#desired = true;
    this.#retrylessFailed = false;
    if (this.#connectivity && this.#connectivityState === 'offline') {
      this.#suspended = true;
      const cancelRetry = this.#takeRetry();
      const attempt = this.#attempt;
      const suspend = () => this.#suspendLifecycle(operation);
      if (attempt) this.#retire(attempt, suspend);
      else suspend();
      this.#safeCleanup(cancelRetry, 'retry cancel');
      return;
    }
    this.#suspended = false;
    const cancelRetry = this.#takeRetry();
    this.#retire(this.#attempt);
    this.#safeCleanup(cancelRetry, 'retry cancel');
    if (!this.#isCurrentOperation(operation)) return;
    this.#fsm.send({ type: 'RECONNECT' });
  }

  disconnect() {
    if (this.#stopped) return;
    const operation = ++this.#operation;
    const wasSuspended = this.#suspended;
    this.#desired = false;
    this.#suspended = false;
    this.#retrylessFailed = false;
    const cancelRetry = this.#takeRetry();
    if (this.#connectivity) {
      const attempt = this.#attempt;
      const disconnect = () => {
        if (!this.#isCurrentOperation(operation)) return;
        if (this.state !== 'idle' || wasSuspended)
          this.#fsm.send({ type: 'DISCONNECT' });
        else this.#refreshSnapshot();
      };
      if (attempt) this.#retire(attempt, disconnect);
      else disconnect();
      this.#safeCleanup(cancelRetry, 'retry cancel');
      return;
    }
    this.#retire(this.#attempt);
    this.#safeCleanup(cancelRetry, 'retry cancel');
    if (!this.#isCurrentOperation(operation)) return;
    if (this.state === 'idle') return;
    this.#fsm.send({ type: 'DISCONNECT' });
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#operation++;
    this.#desired = false;
    this.#suspended = false;
    const cancelRetry = this.#takeRetry();
    this.#retire(this.#attempt);
    this.#safeCleanup(cancelRetry, 'retry cancel');
    if (this.state !== 'stopped')
      this.#safeCleanup(() => this.#fsm.send({ type: 'STOP' }), 'fsm stop');
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    this.#safeCleanup(unsubscribe, 'fsm unsubscribe');
    const connectivityUnsubscribe = this.#connectivityUnsubscribe;
    this.#connectivityUnsubscribe = null;
    this.#safeCleanup(connectivityUnsubscribe, 'connectivity unsubscribe');
    this.#safeCleanup(() => this.#events.stop(), 'events stop');
  }

  [Symbol.dispose]() {
    this.stop();
  }

  subscribe(listener) {
    const existing = this.#stateSubscriptions.get(listener);
    if (existing) return existing.unsubscribe;
    const wrapper = (snapshot) => {
      if (snapshot === this.#clientSnapshot) listener(snapshot);
    };
    const unsubscribe = this.#events.on('state', wrapper);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      unsubscribe();
      this.#stateSubscriptions.delete(listener);
    };
    this.#stateSubscriptions.set(listener, { unsubscribe: release });
    return release;
  }

  onReady(listener) {
    return this.#events.on('ready', listener);
  }

  onMessage(listener) {
    return this.#events.on('message', listener);
  }

  onError(listener) {
    return this.#events.on('error', listener);
  }

  send(message) {
    const attempt = this.#attempt;
    return this.#send(attempt, message);
  }

  probeNow() {
    const attempt = this.#attempt;
    if (!this.#isReadyAttempt(attempt)) return;
    try {
      attempt.monitor?.probeNow();
    } catch (cause) {
      this.#fail(attempt, cause);
    }
  }

  #onSnapshot(snapshot) {
    if (this.#stopped && snapshot.value !== 'stopped') return;
    if (this.#fsm.snapshot !== snapshot) return;
    const operation = this.#operation;
    const clientSnapshot = this.#commitSnapshot(snapshot);
    if (snapshot.value !== 'backoff') this.#cancelRetry();
    if (this.#clientSnapshot !== clientSnapshot) return;
    this.#emit('state', clientSnapshot);
    if (
      this.#fsm.snapshot !== snapshot ||
      this.#operation !== operation ||
      this.#stopped
    )
      return;
    if (this.#connectivity && this.#connectivityState === 'offline') return;
    if (snapshot.value === 'connecting' && this.#desired && !this.#attempt)
      this.#startAttempt();
    else if (snapshot.value === 'backoff' && this.#desired)
      this.#scheduleRetry(snapshot);
  }

  #startAttempt() {
    const attempt = {
      transport: null,
      connectTimer: null,
      monitor: null,
      unsubscribe: null,
      messageUnsubscribes: new Set(),
      opened: false,
      ready: false,
    };
    this.#attempt = attempt;
    this.#armConnectTimeout(attempt);
    if (!this.#isCurrentAttempt(attempt)) return;

    let transport;
    try {
      const createTransport = this.#createTransport;
      transport = createTransport();
    } catch (cause) {
      this.#fail(attempt, cause);
      return;
    }

    if (!this.#isCurrentAttempt(attempt)) {
      this.#disposeTransport(transport);
      return;
    }
    attempt.transport = transport;
    const handlers = {
      onOpen: () => this.#onOpen(attempt),
      onMessage: (message) => this.#onMessage(attempt, message),
      onError: (cause) => this.#reportError(attempt, cause),
      onClose: (close) => this.#fail(attempt, close),
    };
    try {
      transport.start(handlers);
    } catch (cause) {
      this.#fail(attempt, cause);
    }
  }

  #armConnectTimeout(attempt) {
    const delayMs = this.#connectTimeoutMs;
    if (delayMs === undefined) return;

    const timer = {};
    attempt.connectTimer = timer;
    try {
      timer.handle = this.#scheduler.setTimeout(() => {
        if (
          attempt.connectTimer !== timer ||
          !this.#isCurrentAttempt(attempt) ||
          attempt.opened
        )
          return;
        attempt.connectTimer = null;
        this.#fail(attempt, new Error('Connection timed out'));
      }, delayMs);
    } catch (cause) {
      if (attempt.connectTimer === timer) attempt.connectTimer = null;
      this.#fail(attempt, cause);
      return;
    }
    if (attempt.connectTimer !== timer) this.#clearTimer(timer);
  }

  #onOpen(attempt) {
    if (!this.#isCurrentAttempt(attempt) || attempt.opened) return;
    attempt.opened = true;
    this.#clearConnectTimeout(attempt);
    if (!this.#isCurrentAttempt(attempt)) return;

    if (this.#createKeepalive) {
      let monitor;
      try {
        const createKeepalive = this.#createKeepalive;
        monitor = createKeepalive({
          send: (message) => this.#send(attempt, message),
          onMessage: (listener) =>
            this.#subscribeAttemptMessage(attempt, listener),
        });
        if (!monitor)
          throw new TypeError('createKeepalive must return a monitor');
      } catch (cause) {
        this.#fail(attempt, cause);
        return;
      }

      if (!this.#isCurrentAttempt(attempt)) {
        this.#stopMonitor(monitor);
        return;
      }
      attempt.monitor = monitor;
      try {
        const unsubscribe = monitor.onFail((cause) =>
          this.#fail(attempt, cause),
        );
        if (typeof unsubscribe !== 'function')
          throw new TypeError(
            'monitor.onFail must return an unsubscribe function',
          );
        attempt.unsubscribe = unsubscribe;
        if (!this.#isCurrentAttempt(attempt)) {
          attempt.unsubscribe = null;
          this.#safeCleanup(unsubscribe, 'monitor unsubscribe');
          return;
        }
        monitor.start();
      } catch (cause) {
        this.#fail(attempt, cause);
        return;
      }
      if (!this.#isCurrentAttempt(attempt)) return;
    }

    const reason = this.#wasReady ? 'reconnect' : 'initial';
    attempt.ready = true;
    this.#wasReady = true;
    this.#fsm.send({ type: 'READY' });
    if (!this.#isReadyAttempt(attempt)) return;
    this.#emit('ready', { reason });
  }

  #onMessage(attempt, message) {
    if (!this.#isReadyAttempt(attempt)) return;
    try {
      attempt.monitor?.activity();
    } catch (cause) {
      this.#fail(attempt, cause);
      return;
    }
    if (!this.#isReadyAttempt(attempt)) return;
    this.#emit('message', message);
  }

  #subscribeAttemptMessage(attempt, listener) {
    if (typeof listener !== 'function')
      throw new TypeError('listener must be a function');
    if (!this.#isCurrentAttempt(attempt)) return NOOP;
    const wrapper = (message) => {
      if (this.#isReadyAttempt(attempt)) listener(message);
    };
    const unsubscribe = this.#events.on('message', wrapper);
    if (typeof unsubscribe !== 'function')
      throw new TypeError('events.on must return an unsubscribe function');
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      attempt.messageUnsubscribes.delete(release);
      this.#safeCleanup(unsubscribe, 'message unsubscribe');
    };
    if (!this.#isCurrentAttempt(attempt)) {
      release();
      return NOOP;
    }
    attempt.messageUnsubscribes.add(release);
    return release;
  }

  #send(attempt, message) {
    if (!this.#isReadyAttempt(attempt) || !attempt.transport) return false;
    try {
      attempt.transport.send(message);
      return true;
    } catch (cause) {
      this.#emit('error', cause);
      return false;
    }
  }

  #fail(attempt, cause) {
    if (!this.#isCurrentAttempt(attempt)) return;
    const operation = ++this.#operation;
    this.#retire(attempt);
    if (this.#operation === operation && this.#desired && !this.#stopped) {
      if (this.#retry) this.#fsm.send({ type: 'FAIL' });
      else {
        if (this.#connectivity) {
          this.#retrylessFailed = true;
        } else {
          this.#desired = false;
        }
        this.#fsm.send({ type: 'DISCONNECT' });
      }
    }
    this.#emit('error', cause);
  }

  #reportError(attempt, cause) {
    if (!this.#isCurrentAttempt(attempt)) return;
    this.#emit('error', cause);
  }

  #scheduleRetry(snapshot) {
    const retry = this.#retry;
    if (!retry || this.#retryRecord || !this.#desired) return;
    const record = { snapshot, cancel: null };
    this.#retryRecord = record;
    try {
      const cancel = retry.schedule(snapshot.context.attempt, () => {
        if (
          this.#stopped ||
          !this.#desired ||
          this.#retryRecord !== record ||
          this.#fsm.snapshot !== snapshot
        )
          return;
        this.#retryRecord = null;
        this.#fsm.send({ type: 'RETRY' });
      });
      if (typeof cancel !== 'function')
        throw new TypeError(
          'retry.schedule must return a cancellation function',
        );
      record.cancel = cancel;
      if (this.#retryRecord !== record)
        this.#safeCleanup(cancel, 'retry cancel');
    } catch (cause) {
      if (this.#retryRecord !== record) return;
      this.#retryRecord = null;
      this.#retryFailed(snapshot, cause);
    }
  }

  #retryFailed(snapshot, cause) {
    if (
      this.#stopped ||
      !this.#desired ||
      this.#fsm.snapshot !== snapshot ||
      snapshot.value !== 'backoff'
    )
      return;
    this.#operation++;
    this.#desired = false;
    this.#fsm.send({ type: 'DISCONNECT' });
    this.#emit('error', cause);
  }

  #onConnectivity(state) {
    if (!this.#connectivity || this.#stopped) return;
    if (!isConnectivityState(state)) {
      this.#warn('RealtimeClient connectivity state is invalid', { state });
      return;
    }
    const previous = this.#connectivityState;
    if (previous === state) return;
    this.#connectivityState = state;
    if (state === 'offline') {
      this.#suspended = this.#desired;
      this.#retrylessFailed = false;
      const operation = ++this.#operation;
      const cancelRetry = this.#takeRetry();
      const attempt = this.#attempt;
      const suspend = () => {
        if (this.#desired || this.state !== 'idle')
          this.#suspendLifecycle(operation);
        else this.#refreshSnapshot();
      };
      if (attempt) this.#retire(attempt, suspend);
      else suspend();
      this.#safeCleanup(cancelRetry, 'retry cancel');
      return;
    }
    if (this.#suspended && this.#desired) {
      this.#suspended = false;
      this.#retrylessFailed = false;
      const operation = ++this.#operation;
      if (this.state === 'idle') {
        if (this.#isCurrentOperation(operation))
          this.#fsm.send({ type: 'CONNECT' });
      } else if (this.state === 'backoff') {
        const cancelRetry = this.#takeRetry();
        this.#safeCleanup(cancelRetry, 'retry cancel');
        if (this.#isCurrentOperation(operation))
          this.#fsm.send({ type: 'RETRY' });
      } else this.#refreshSnapshot();
    } else this.#refreshSnapshot();
  }

  #suspendLifecycle(operation) {
    if (!this.#isCurrentOperation(operation) || this.state === 'stopped')
      return;
    this.#fsm.send({ type: 'SUSPEND' });
  }

  #refreshSnapshot() {
    if (!this.#connectivity) return;
    const previous = this.#clientSnapshot;
    const snapshot = this.#commitSnapshot(this.#fsm.snapshot);
    if (snapshot !== previous) this.#emit('state', snapshot);
  }

  #commitSnapshot(rawSnapshot) {
    if (!this.#connectivity) {
      this.#clientRawSnapshot = rawSnapshot;
      this.#clientSnapshot = rawSnapshot;
      return rawSnapshot;
    }
    if (
      rawSnapshot === this.#clientRawSnapshot &&
      this.#clientSnapshot.connectivity === this.#connectivityState &&
      this.#clientSnapshot.suspended === this.#suspended
    )
      return this.#clientSnapshot;
    this.#clientRawSnapshot = rawSnapshot;
    const version = Math.max(
      rawSnapshot.version,
      this.#clientSnapshot.version + 1,
    );
    this.#clientSnapshot = Object.freeze({
      ...rawSnapshot,
      connectivity: this.#connectivityState,
      suspended: this.#suspended,
      version,
    });
    return this.#clientSnapshot;
  }

  #retire(attempt, beforeCleanup) {
    if (!attempt || this.#attempt !== attempt) return;
    this.#attempt = null;
    attempt.ready = false;
    const connectTimer = attempt.connectTimer;
    attempt.connectTimer = null;
    const unsubscribe = attempt.unsubscribe;
    attempt.unsubscribe = null;
    const messageUnsubscribes = [...attempt.messageUnsubscribes];
    attempt.messageUnsubscribes.clear();
    const monitor = attempt.monitor;
    attempt.monitor = null;
    const transport = attempt.transport;
    attempt.transport = null;
    if (typeof beforeCleanup === 'function') {
      try {
        beforeCleanup();
      } catch (cause) {
        this.#warn('RealtimeClient retirement callback failed', { cause });
      }
    }
    if (connectTimer) this.#clearTimer(connectTimer);
    for (const release of messageUnsubscribes)
      this.#safeCleanup(release, 'message unsubscribe');
    this.#safeCleanup(unsubscribe, 'monitor unsubscribe');
    this.#stopMonitor(monitor);
    this.#disposeTransport(transport);
  }

  #clearConnectTimeout(attempt) {
    const timer = attempt.connectTimer;
    attempt.connectTimer = null;
    if (timer) this.#clearTimer(timer);
  }

  #clearTimer(timer) {
    if (!Object.hasOwn(timer, 'handle')) return;
    this.#safeCleanup(
      () => this.#scheduler.clearTimeout(timer.handle),
      'connect timeout clear',
    );
  }

  #stopMonitor(monitor) {
    if (monitor) this.#safeCleanup(() => monitor.stop(), 'monitor stop');
  }

  #disposeTransport(transport) {
    if (transport)
      this.#safeCleanup(() => transport[Symbol.dispose](), 'transport dispose');
  }

  #cancelRetry() {
    this.#safeCleanup(this.#takeRetry(), 'retry cancel');
  }

  #takeRetry() {
    const record = this.#retryRecord;
    this.#retryRecord = null;
    return record?.cancel;
  }

  #isCurrentAttempt(attempt) {
    return !this.#stopped && this.#attempt === attempt;
  }

  #isReadyAttempt(attempt) {
    return (
      this.#isCurrentAttempt(attempt) &&
      attempt?.ready === true &&
      this.state === 'ready'
    );
  }

  #isCurrentOperation(operation) {
    return !this.#stopped && this.#operation === operation;
  }

  #emit(type, payload) {
    try {
      this.#events.emit(type, payload);
    } catch (cause) {
      this.#warn(`RealtimeClient ${type} event failed`, cause);
    }
  }

  #safeCleanup(cleanup, operation) {
    if (typeof cleanup !== 'function') return;
    try {
      cleanup();
    } catch (cause) {
      this.#warn(`RealtimeClient ${operation} failed`, cause);
    }
  }

  #warn(message, cause) {
    try {
      this.#logger?.warn?.(message, { cause });
    } catch {}
  }
}

function assertDeps(deps) {
  if (!deps || typeof deps !== 'object')
    throw new TypeError('client dependencies are required');
  if (
    !deps.fsm ||
    typeof deps.fsm.send !== 'function' ||
    typeof deps.fsm.subscribe !== 'function' ||
    !deps.fsm.snapshot ||
    typeof deps.fsm.state !== 'string'
  )
    throw new TypeError(
      'fsm must provide state, snapshot, send, and subscribe',
    );
  if (
    !deps.events ||
    typeof deps.events.on !== 'function' ||
    typeof deps.events.emit !== 'function' ||
    typeof deps.events.stop !== 'function'
  )
    throw new TypeError('events must provide on, emit, and stop');
  if (typeof deps.createTransport !== 'function')
    throw new TypeError('createTransport must be a function');
  if (
    deps.retry !== undefined &&
    deps.retry !== null &&
    typeof deps.retry.schedule !== 'function'
  )
    throw new TypeError('retry must provide schedule(attempt, callback)');
  if (
    deps.createKeepalive !== undefined &&
    deps.createKeepalive !== null &&
    typeof deps.createKeepalive !== 'function'
  )
    throw new TypeError('createKeepalive must be a function');
  if (deps.connectivity !== undefined && deps.connectivity !== null)
    assertConnectivitySource(deps.connectivity);
  if (
    deps.connectTimeoutMs !== undefined &&
    (!Number.isInteger(deps.connectTimeoutMs) ||
      deps.connectTimeoutMs < 1 ||
      deps.connectTimeoutMs > MAX_TIMER_MS)
  )
    throw new RangeError('connectTimeoutMs must be a positive timer duration');
}

function assertConnectivitySource(source) {
  if (
    !source ||
    typeof source.getSnapshot !== 'function' ||
    typeof source.subscribe !== 'function'
  )
    throw new TypeError('connectivity must provide getSnapshot and subscribe');
}

function isConnectivityState(state) {
  return state === 'online' || state === 'offline';
}
