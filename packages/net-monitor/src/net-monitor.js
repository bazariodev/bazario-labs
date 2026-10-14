const STATES = new Set(['online', 'offline', 'unknown']);
const noop = () => {};

export class BrowserNetMonitor {
  #platform;
  #onListenerError;
  #listeners = new Set();
  #snapshot = 'unknown';
  #attached = false;
  #stopped = false;
  #generation = 0;
  #onOnline;
  #onOffline;

  constructor({ platform = globalThis, onListenerError } = {}) {
    this.#platform = platform;
    this.#onListenerError = onListenerError;
    this.#onOnline = () => this.#update('online');
    this.#onOffline = () => this.#update('offline');
  }

  getSnapshot() {
    if (this.#stopped) return this.#snapshot;
    if (this.#listeners.size > 0) return this.#snapshot;
    const state = readState(this.#platform);
    this.#snapshot = state;
    return state;
  }

  subscribe(listener) {
    if (typeof listener !== 'function')
      throw new TypeError('listener must be a function');
    if (this.#stopped) return noop;

    const registration = { listener, active: true };
    this.#listeners.add(registration);
    if (this.#listeners.size === 1) {
      try {
        this.#attach();
      } catch (cause) {
        this.#listeners.delete(registration);
        registration.active = false;
        this.#detach();
        throw cause;
      }
    }

    this.#update(readState(this.#platform));
    return () => {
      if (!registration.active) return;
      registration.active = false;
      this.#listeners.delete(registration);
      if (this.#listeners.size === 0) this.#detach();
    };
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#detach();
    for (const registration of this.#listeners) registration.active = false;
    this.#listeners.clear();
  }

  [Symbol.dispose]() {
    this.stop();
  }

  #attach() {
    if (this.#attached) return;
    const platform = this.#platform;
    if (
      !platform ||
      typeof platform.addEventListener !== 'function' ||
      typeof platform.removeEventListener !== 'function'
    )
      return;

    try {
      platform.addEventListener('online', this.#onOnline);
      if (this.#stopped || this.#listeners.size === 0) {
        this.#removeListener('online', this.#onOnline);
        return;
      }
      platform.addEventListener('offline', this.#onOffline);
      if (this.#stopped || this.#listeners.size === 0) {
        this.#removeListener('offline', this.#onOffline);
        this.#removeListener('online', this.#onOnline);
        return;
      }
      this.#attached = true;
    } catch (cause) {
      this.#removeListener('offline', this.#onOffline);
      this.#removeListener('online', this.#onOnline);
      throw cause;
    }
  }

  #detach() {
    if (!this.#attached) return;
    this.#attached = false;
    this.#removeListener('online', this.#onOnline);
    this.#removeListener('offline', this.#onOffline);
  }

  #removeListener(type, listener) {
    try {
      this.#platform.removeEventListener(type, listener);
    } catch (cause) {
      this.#reportListenerError(cause);
    }
  }

  #update(state) {
    if (this.#stopped || !STATES.has(state) || state === this.#snapshot) return;
    this.#snapshot = state;
    const generation = ++this.#generation;
    for (const registration of [...this.#listeners]) {
      if (!registration.active || this.#generation !== generation) continue;
      try {
        registration.listener(state);
      } catch (cause) {
        this.#reportListenerError(cause);
      }
    }
  }

  #reportListenerError(error) {
    try {
      this.#onListenerError?.(error);
    } catch {}
  }
}

function readState(platform) {
  try {
    if (typeof platform?.navigator?.onLine === 'boolean')
      return platform.navigator.onLine ? 'online' : 'offline';
  } catch {}
  return 'unknown';
}
