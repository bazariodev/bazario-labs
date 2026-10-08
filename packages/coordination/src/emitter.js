export class Emitter {
  #listeners = new Map();
  #stopped = false;
  #logger;

  constructor({ logger = noopLogger } = {}) {
    this.#logger = logger;
  }

  on(type, listener) {
    if (this.#stopped) return noop;
    if (typeof listener !== 'function')
      throw new TypeError('listener must be a function');

    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Map();
      this.#listeners.set(type, listeners);
    }

    const existing = listeners.get(listener);
    if (existing) return existing.unsubscribe;

    const registration = { listener, unsubscribe: undefined };
    registration.unsubscribe = () => {
      const current = this.#listeners.get(type);
      if (current?.get(listener) !== registration) return;
      current.delete(listener);
      if (current.size === 0) this.#listeners.delete(type);
    };

    listeners.set(listener, registration);
    return registration.unsubscribe;
  }

  emit(type, payload) {
    if (this.#stopped) return;
    const listeners = this.#listeners.get(type);
    if (!listeners) return;

    for (const { listener } of [...listeners.values()]) {
      if (this.#stopped) return;

      try {
        listener(payload);
      } catch (error) {
        this.#logger.error('coordination: event listener failed', {
          type,
          error,
        });
      }
    }
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#listeners.clear();
  }

  [Symbol.dispose]() {
    this.stop();
  }
}

const noop = () => undefined;
const noopLogger = { error: () => undefined };
