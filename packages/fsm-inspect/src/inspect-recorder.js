import { MESSAGES } from './internal/messages.js';

const identity = (value) => value;

// The clock and redaction hooks stay off the public class; the capture layers
// reach them through `capture`. Membership also brands genuine recorders.
const hooksByRecorder = new WeakMap();

/** A bounded timeline of inspection entries, oldest first. */
export class InspectRecorder {
  #limit;
  #onEntry;
  #logger;
  #entries = [];
  #entriesCache = null;
  #nextAttemptId = 1;

  // Capture is fail-silent, so a bad option would quietly record nothing.
  constructor(options = {}) {
    const { limit = 500 } = options;
    if (!(Number.isInteger(limit) && limit >= 1)) {
      throw new Error(MESSAGES.invalidLimit);
    }
    for (const option of [
      'now',
      'mapContext',
      'mapSnapshot',
      'mapEvent',
      'mapMeta',
      'onEntry',
    ]) {
      const value = options[option];
      if (value !== undefined && typeof value !== 'function') {
        throw new Error(MESSAGES.notAFunction(option));
      }
    }

    this.#limit = limit;
    this.#onEntry = options.onEntry;
    this.#logger = Object.freeze({
      debug: (message, meta) => this.#log('debug', message, meta),
      warn: (message, meta) => this.#log('warn', message, meta),
      error: (message, meta) => this.#log('error', message, meta),
    });
    hooksByRecorder.set(this, {
      now: options.now ?? Date.now,
      mapContext: options.mapContext ?? identity,
      mapSnapshot: options.mapSnapshot ?? identity,
      mapEvent: options.mapEvent ?? identity,
      mapMeta: options.mapMeta ?? identity,
    });
  }

  // A frozen copy, cached until the next write.
  get entries() {
    this.#entriesCache ??= Object.freeze([...this.#entries]);
    return this.#entriesCache;
  }

  get logger() {
    return this.#logger;
  }

  record(entry) {
    const stored = Object.freeze({ ...entry });
    if (this.#entries.push(stored) > this.#limit) this.#entries.shift();
    this.#entriesCache = null;

    try {
      this.#onEntry?.(stored);
    } catch {
      // Inspect must never break the observed system.
    }
  }

  nextAttemptId() {
    return this.#nextAttemptId++;
  }

  clear() {
    this.#entries.length = 0;
    this.#entriesCache = null;
  }

  #log(level, message, meta) {
    capture(this, (at, { mapMeta }) =>
      meta === undefined
        ? { type: 'log', at, level, message }
        : { type: 'log', at, level, message, meta: mapMeta(meta) },
    );
  }
}

export function assertRecorder(value) {
  if (!hooksByRecorder.has(value)) throw new Error(MESSAGES.invalidRecorder);
}

/**
 * Records `build(at, hooks)`, with `at` from the recorder's clock. A throwing
 * clock or hook drops the entry: the capture layers run inside the observed
 * machine, and the logger inside its error paths.
 */
export function capture(recorder, build) {
  const hooks = hooksByRecorder.get(recorder);
  try {
    recorder.record(build(hooks.now(), hooks));
  } catch {
    // Observation must never break the observed system.
  }
}
