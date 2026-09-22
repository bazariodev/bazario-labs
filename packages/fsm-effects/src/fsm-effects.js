import { MESSAGES } from './internal/messages.js';

const WILDCARD = '*';
const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

export class FsmEffects {
  #machine;
  #effects;
  #logger;
  #unsubscribe;
  #controller = new AbortController();
  #state;
  #version;
  #pending = null;
  #draining = false;
  #stopped = false;

  constructor(machine, config) {
    this.#machine = machine;
    this.#effects = compileEffects(config.effects);
    this.#logger = config.logger ?? NOOP_LOGGER;

    const snapshot = machine.snapshot;
    this.#state = snapshot.value;
    this.#version = snapshot.version;
    // Subscribe first so a synchronous send from an initial effect reaches the runner.
    this.#unsubscribe = machine.subscribe((next) => this.#onSnapshot(next));
    this.#pending = snapshot;
    this.#drain();
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#controller.abort();
    this.#unsubscribe();
  }

  [Symbol.dispose]() {
    this.stop();
  }

  #onSnapshot(snapshot) {
    // The version guard drops stale or repeated deliveries from any FsmCore source.
    if (this.#stopped || snapshot.version <= this.#version) return;
    this.#version = snapshot.version;
    // Self-transitions keep the running effects.
    if (snapshot.value === this.#state) return;
    this.#state = snapshot.value;
    this.#pending = snapshot;
    this.#drain();
  }

  // One loop owns every controller swap and spawn; a nested send() only records
  // the newest target, so synchronous cascades never recurse or interleave.
  #drain() {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#pending && !this.#stopped) {
        const snapshot = this.#pending;
        this.#pending = null;

        const previous = this.#controller;
        this.#controller = new AbortController();
        previous.abort(); // runs the leaving state's cleanups, which may send()

        if (!this.#pending && !this.#stopped) this.#spawn(snapshot);
      }
    } finally {
      this.#draining = false;
    }
  }

  #spawn(snapshot) {
    const { signal } = this.#controller;
    const api = Object.freeze({
      signal,
      send: (event) => {
        if (!signal.aborted) this.#machine.send(event);
      },
    });
    const effects = [
      ...(this.#effects.get(snapshot.value) ?? []),
      ...(this.#effects.get(WILDCARD) ?? []),
    ];

    for (const effect of effects) {
      // Stop once stopped, or once an effect's send() moved the machine on.
      if (signal.aborted || this.#pending) return;
      this.#run(effect, snapshot, api);
    }
  }

  #run(effect, snapshot, api) {
    const { signal } = api;
    const meta = { state: snapshot.value, version: snapshot.version };
    let result;
    try {
      result = effect(snapshot, api);
    } catch (error) {
      this.#logger.error(MESSAGES.effectThrew, { ...meta, error });
      return;
    }

    // Check for a cleanup first: a function may also carry a `then` property.
    if (typeof result === 'function' || typeof result?.then !== 'function') {
      this.#addCleanup(result, signal);
      return;
    }
    result.then(
      (cleanup) => this.#addCleanup(cleanup, signal),
      (error) => {
        if (signal.aborted) {
          this.#logger.debug(MESSAGES.effectRejectedAfterAbort, {
            ...meta,
            error,
          });
        } else {
          this.#logger.error(MESSAGES.effectRejected, { ...meta, error });
        }
      },
    );
  }

  #addCleanup(cleanup, signal) {
    if (typeof cleanup !== 'function') return;
    const run = () => {
      try {
        cleanup();
      } catch (error) {
        this.#logger.error(MESSAGES.cleanupThrew, { error });
      }
    };
    // A cleanup that arrives after abort runs immediately instead of never.
    if (signal.aborted) run();
    else signal.addEventListener('abort', run, { once: true });
  }
}

/** Copies the effects map so later caller mutation has no effect. */
function compileEffects(effects) {
  if (!isPlainObject(effects)) throw new Error(MESSAGES.effectsNotObject);
  const compiled = new Map();
  for (const [key, entry] of Object.entries(effects)) {
    if (entry === undefined) continue;
    const list = Array.isArray(entry) ? [...entry] : [entry];
    // Effect errors are logged, not thrown, so fail fast on a non-function here.
    if (!list.every((effect) => typeof effect === 'function')) {
      throw new Error(MESSAGES.effectNotFunction(key));
    }
    compiled.set(key, list);
  }
  return compiled;
}

// Object.entries() accepts arrays, primitives, Maps, and Dates without error, and
// each of those would silently disable every effect.
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
