const NOOP = () => {};
const MIN_IDLE_MS = 1;
const MAX_IDLE_MS = 2_147_483_647;
const NOOP_LOGGER = { error: NOOP };
const DEFAULT_SCHEDULER = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

export class IdleWatchdog {
  #idleMs;
  #scheduler;
  #logger;
  #timer = null;
  #listeners = new Map();
  #stopped = false;

  constructor({ idleMs, scheduler = DEFAULT_SCHEDULER, logger = NOOP_LOGGER }) {
    if (
      !Number.isInteger(idleMs) ||
      idleMs < MIN_IDLE_MS ||
      idleMs > MAX_IDLE_MS
    ) {
      throw new RangeError(
        `idleMs must be an integer between ${MIN_IDLE_MS} and ${MAX_IDLE_MS}.`,
      );
    }
    this.#idleMs = idleMs;
    this.#scheduler = scheduler;
    this.#logger = logger;
  }

  arm() {
    if (this.#stopped) return;
    this.cancel();

    // Identity guards queued callbacks even when a scheduler reuses timer handles.
    const timer = {};
    this.#timer = timer;
    timer.handle = this.#scheduler.setTimeout(() => {
      if (this.#timer !== timer) return;
      // Disarm before notifying so a subscriber can safely re-arm the watchdog.
      this.#timer = null;
      for (const listener of [...this.#listeners.keys()]) {
        if (this.#stopped) break;
        try {
          listener();
        } catch (error) {
          this.#logger.error('IdleWatchdog idle listener threw.', error);
        }
      }
    }, this.#idleMs);
  }

  cancel() {
    const timer = this.#timer;
    this.#timer = null;
    if (timer !== null) this.#scheduler.clearTimeout(timer.handle);
  }

  onIdle(listener) {
    if (this.#stopped) return NOOP;
    const subscription = this.#listeners.get(listener) ?? {};
    this.#listeners.set(listener, subscription);
    return () => {
      // Duplicate registrations share ownership; old cleanup cannot remove a new one.
      if (this.#listeners.get(listener) === subscription) {
        this.#listeners.delete(listener);
      }
    };
  }

  stop() {
    this.#stopped = true;
    this.cancel();
    this.#listeners.clear();
  }

  [Symbol.dispose]() {
    this.stop();
  }
}
