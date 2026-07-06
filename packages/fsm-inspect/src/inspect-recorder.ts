import { MESSAGES } from './internal/messages.js';
import { isFunction } from './internal/predicates.js';
import type { InspectEntry, InspectRecorderOptions, Logger } from './types.js';

type RecorderInternals = {
  readonly now: () => number;
  readonly mapContext: (context: unknown) => unknown;
  readonly mapSnapshot: (snapshot: unknown) => unknown;
  readonly mapEvent: (event: unknown) => unknown;
  readonly mapMeta: (meta: unknown) => unknown;
};

const DEFAULT_LIMIT = 500;
const identity = (value: unknown): unknown => value;
const internals = new WeakMap<InspectRecorder, RecorderInternals>();

export class InspectRecorder {
  readonly #limit: number;
  readonly #onEntry?: (entry: InspectEntry) => void;
  readonly #entries: InspectEntry[] = [];
  readonly #logger: Logger;

  #entriesCache: ReadonlyArray<InspectEntry> | null = null;
  #nextAttemptId = 1;

  constructor(options: InspectRecorderOptions = {}) {
    validateOptions(options);

    this.#limit = options.limit ?? DEFAULT_LIMIT;
    this.#onEntry = options.onEntry;
    this.#logger = Object.freeze({
      debug: (message: string, meta?: unknown) =>
        this.#recordLog('debug', message, meta),
      warn: (message: string, meta?: unknown) =>
        this.#recordLog('warn', message, meta),
      error: (message: string, meta?: unknown) =>
        this.#recordLog('error', message, meta),
    });

    internals.set(this, {
      now: options.now ?? Date.now,
      mapContext: options.mapContext ?? identity,
      mapSnapshot: options.mapSnapshot ?? identity,
      mapEvent: options.mapEvent ?? identity,
      mapMeta: options.mapMeta ?? identity,
    });
  }

  get entries(): ReadonlyArray<InspectEntry> {
    if (!this.#entriesCache) {
      this.#entriesCache = Object.freeze([...this.#entries]);
    }

    return this.#entriesCache;
  }

  get logger(): Logger {
    return this.#logger;
  }

  record(entry: InspectEntry): void {
    const stored = Object.freeze({ ...entry }) as InspectEntry;

    this.#entries.push(stored);
    while (this.#entries.length > this.#limit) this.#entries.shift();
    this.#entriesCache = null;

    try {
      this.#onEntry?.(stored);
    } catch {
      // Inspect must never break the observed system.
    }
  }

  nextAttemptId(): number {
    return this.#nextAttemptId++;
  }

  clear(): void {
    this.#entries.length = 0;
    this.#entriesCache = null;
  }

  #recordLog(
    level: 'debug' | 'warn' | 'error',
    message: string,
    meta: unknown,
  ) {
    const at = timestampFor(this);
    if (at === null) return;

    try {
      const mappedMeta =
        meta === undefined ? undefined : mapMetaFor(this, meta);
      this.record(
        mappedMeta === undefined
          ? { type: 'log', at, level, message }
          : { type: 'log', at, level, message, meta: mappedMeta },
      );
    } catch {
      // Logger adapters may be called from core error paths; drop instead.
    }
  }
}

export function assertRecorder(
  value: unknown,
): asserts value is InspectRecorder {
  if (!(value instanceof InspectRecorder))
    throw new Error(MESSAGES.invalidRecorder);
}

export function timestampFor(recorder: InspectRecorder): number | null {
  try {
    const at = internalsFor(recorder).now();
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function mapContextFor(
  recorder: InspectRecorder,
  context: unknown,
): unknown {
  return internalsFor(recorder).mapContext(context);
}

export function mapSnapshotFor(
  recorder: InspectRecorder,
  snapshot: unknown,
): unknown {
  return internalsFor(recorder).mapSnapshot(snapshot);
}

export function mapEventFor(
  recorder: InspectRecorder,
  event: unknown,
): unknown {
  return internalsFor(recorder).mapEvent(event);
}

function mapMetaFor(recorder: InspectRecorder, meta: unknown): unknown {
  return internalsFor(recorder).mapMeta(meta);
}

function internalsFor(recorder: InspectRecorder): RecorderInternals {
  const state = internals.get(recorder);
  if (!state) throw new Error(MESSAGES.invalidRecorder);
  return state;
}

function validateOptions(options: InspectRecorderOptions): void {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) ||
      !Number.isFinite(options.limit) ||
      options.limit < 1)
  ) {
    throw new Error(MESSAGES.invalidLimit);
  }

  if (options.now !== undefined && !isFunction(options.now)) {
    throw new Error(MESSAGES.invalidNow);
  }
  if (options.mapContext !== undefined && !isFunction(options.mapContext)) {
    throw new Error(MESSAGES.invalidMapContext);
  }
  if (options.mapSnapshot !== undefined && !isFunction(options.mapSnapshot)) {
    throw new Error(MESSAGES.invalidMapSnapshot);
  }
  if (options.mapEvent !== undefined && !isFunction(options.mapEvent)) {
    throw new Error(MESSAGES.invalidMapEvent);
  }
  if (options.mapMeta !== undefined && !isFunction(options.mapMeta)) {
    throw new Error(MESSAGES.invalidMapMeta);
  }
  if (options.onEntry !== undefined && !isFunction(options.onEntry)) {
    throw new Error(MESSAGES.invalidOnEntry);
  }
}
