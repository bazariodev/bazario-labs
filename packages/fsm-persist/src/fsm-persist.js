import { MAX_SPINE_DEPTH, NOOP_LOGGER } from './internal/constants.js';
import { MESSAGES } from './internal/messages.js';
import {
  isObject,
  requireOptionalFunction,
  validateStorageOptions,
} from './internal/shared.js';

export function persistFsm(source, options) {
  return new FsmPersist(source, toFsmState, options);
}

export function persistHierarchy(source, options) {
  return new FsmPersist(source, toHierarchyState, options);
}

/** Writes a versioned record of the source's snapshot on start and after every commit. */
export class FsmPersist {
  #source;
  #toState;
  #storage;
  #key;
  #name;
  #filter;
  #serialize;
  #logger;
  #now;
  #unsubscribe = null;
  #lastWritten = null;
  #stopped = false;

  constructor(source, toState, options) {
    if (!isObject(source) || typeof source.subscribe !== 'function') {
      throw new Error(MESSAGES.invalidSource);
    }
    if (typeof toState !== 'function') throw new Error(MESSAGES.invalidToState);
    validateStorageOptions(options, options.name);
    requireOptionalFunction(options.filter, MESSAGES.invalidFilter);
    requireOptionalFunction(options.serialize, MESSAGES.invalidSerialize);

    this.#source = source;
    this.#toState = toState;
    this.#storage = options.storage;
    this.#key = options.key;
    this.#name = options.name;
    this.#filter = options.filter;
    this.#serialize = options.serialize ?? JSON.stringify;
    this.#logger = options.logger ?? NOOP_LOGGER;
    this.#now = options.now ?? Date.now;

    this.#unsubscribe = source.subscribe(() => this.#write());
    this.#write();
  }

  clear() {
    try {
      this.#storage.removeItem(this.#key);
    } catch (error) {
      this.#logger.error(MESSAGES.clearFailed, this.#meta(error));
    }
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  [Symbol.dispose]() {
    this.stop();
  }

  // Reads source.snapshot rather than the callback payload, so the record is
  // always the latest committed state. Every failure is contained and logged.
  #write() {
    if (this.#stopped) return;
    try {
      const snapshot = this.#source.snapshot;
      if (Object.is(snapshot, this.#lastWritten)) return;
      if (this.#filter && !this.#filter(snapshot)) return;

      const state = this.#toState(snapshot);
      const at = this.#now();
      // Checked before setItem so an unreadable record never replaces a good one.
      if (!Number.isFinite(at)) {
        throw new Error('now returned a non-finite timestamp');
      }
      const serialized = this.#serialize({
        format: 1,
        name: this.#name,
        at,
        state,
      });
      if (typeof serialized !== 'string') {
        throw new Error('serialize returned a non-string value');
      }

      this.#storage.setItem(this.#key, serialized);
      this.#lastWritten = snapshot;
    } catch (error) {
      this.#logger.error(MESSAGES.writeFailed, this.#meta(error));
    }
  }

  #meta(error) {
    return { key: this.#key, name: this.#name, error };
  }
}

function toFsmState({ value, context }) {
  return { kind: 'fsm', value, context };
}

function toHierarchyState({ root }) {
  const spine = [];
  const seen = new Set();
  for (let node = root; node; node = node.child) {
    // Either case would otherwise loop forever inside a subscriber.
    if (seen.has(node)) throw new Error('hierarchy snapshot contains a cycle');
    if (spine.length >= MAX_SPINE_DEPTH) {
      throw new Error('hierarchy snapshot exceeds maximum persisted depth');
    }
    seen.add(node);
    spine.push({ value: node.value, context: node.context });
  }
  return { kind: 'hierarchy', spine };
}
