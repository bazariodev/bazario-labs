import { IdleWatchdog } from '@bazariodev/idle-watchdog';

import { assertOptions } from './options.js';

const NOOP = () => {};
const NOOP_LOGGER = { error: NOOP };

export class Keepalive {
  #probe;
  #logger;
  #idle;
  #deadline;
  #pending = null;
  #started = false;
  #stopped = false;
  #listeners = new Map();

  constructor(options) {
    assertOptions(options);
    const {
      probe,
      idleMs,
      deadlineMs,
      scheduler,
      logger = NOOP_LOGGER,
    } = options;

    this.#probe = probe;
    this.#logger = logger;
    this.#idle = new IdleWatchdog({ idleMs, scheduler });
    this.#deadline = new IdleWatchdog({ idleMs: deadlineMs, scheduler });
    this.#idle.onIdle(() => this.probeNow());
    this.#deadline.onIdle(() => this.#finish({ type: 'timeout' }));
  }

  start() {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.activity();
  }

  activity() {
    if (!this.#started || this.#stopped || this.#pending) return;
    try {
      this.#idle.arm();
    } catch (error) {
      this.#finish({ type: 'error', error });
    }
  }

  probeNow() {
    if (!this.#started || this.#stopped || this.#pending) return;

    const pending = { controller: new AbortController() };
    this.#pending = pending;

    try {
      this.#idle.cancel();
      this.#deadline.arm();
      const probe = this.#probe;
      const promise = probe(pending.controller.signal);
      if (typeof promise?.then !== 'function')
        throw new TypeError('probe must return a promise.');
      promise.then(
        () => this.#settle(pending),
        (error) => this.#settle(pending, { type: 'error', error }),
      );
    } catch (error) {
      this.#settle(pending, { type: 'error', error });
    }
  }

  onFail(listener) {
    if (this.#stopped) return NOOP;
    const subscription = this.#listeners.get(listener) ?? {};
    this.#listeners.set(listener, subscription);
    return () => {
      if (this.#listeners.get(listener) === subscription)
        this.#listeners.delete(listener);
    };
  }

  stop() {
    this.#finish();
  }

  [Symbol.dispose]() {
    this.stop();
  }

  #settle(pending, failure) {
    if (this.#pending !== pending) return;
    if (failure) {
      this.#finish(failure);
      return;
    }

    this.#pending = null;
    this.#deadline.cancel();
    this.activity();
  }

  #finish(failure) {
    if (this.#stopped) return;
    this.#stopped = true;

    const pending = this.#pending;
    this.#pending = null;
    const listeners = this.#listeners;
    this.#listeners = new Map();

    this.#idle.stop();
    this.#deadline.stop();
    pending?.controller.abort();

    if (!failure) return;
    for (const listener of listeners.keys()) {
      try {
        listener(failure);
      } catch (error) {
        this.#logger.error('Keepalive failure listener threw.', error);
      }
    }
  }
}
