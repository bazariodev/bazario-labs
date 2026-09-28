import { IdleWatchdog } from '@bazariodev/idle-watchdog';

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

  constructor({ idleMs, deadlineMs, probe, scheduler, logger = NOOP_LOGGER }) {
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
    if (!this.#started || this.#stopped || this.#pending !== null) return;
    this.#idle.arm();
  }

  probeNow() {
    if (!this.#started || this.#stopped || this.#pending !== null) return;
    try {
      const pending = new AbortController();
      this.#pending = pending;
      this.#idle.cancel();
      this.#deadline.arm();
      const promise = this.#probe(pending.signal);
      // Attach both handlers even if the probe stops the monitor before returning.
      promise.then(
        () => this.#settle(pending),
        (error) => this.#settle(pending, { type: 'error', error }),
      );
    } catch (error) {
      this.#finish({ type: 'error', error });
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
    // Snapshot before cleanup: abort or owner callbacks may unsubscribe or stop.
    const listeners = this.#listeners;
    this.#listeners = new Map();
    this.#idle.stop();
    this.#deadline.stop();
    pending?.abort();
    if (failure) {
      listeners.forEach((_, listener) => {
        try {
          listener(failure);
        } catch (error) {
          this.#logger.error('Keepalive failure listener threw.', error);
        }
      });
    }
  }
}
