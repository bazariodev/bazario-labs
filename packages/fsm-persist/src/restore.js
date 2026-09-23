import { NOOP_LOGGER } from './internal/constants.js';
import { MESSAGES } from './internal/messages.js';
import {
  hasOwn,
  isObject,
  requireOptionalFunction,
  validateStorageOptions,
} from './internal/shared.js';

// Stored data is untrusted: after option validation, nothing here throws.
// Every read failure degrades to a fresh start (a null record) and is logged.

/** Reads and validates the versioned envelope only; either state kind is accepted. */
export function loadRecord(options) {
  validateRestoreOptions(options, options.name);
  return readRecord(options, options.name);
}

export function restoreFsmConfig(config, options) {
  const { record, name, logger } = readKind(config, options, 'fsm');
  if (!record) return { config, restored: false };

  const { value, context } = record.state;
  if (!hasOwn(config.states, value)) {
    logger.warn(MESSAGES.unknownState, { key: options.key, name, value });
    return { config, restored: false };
  }
  return { config: { ...config, initial: value, context }, restored: true };
}

export function restoreHierarchyConfig(config, options) {
  const { record, name, logger } = readKind(config, options, 'hierarchy');
  if (!record) {
    return { config, restored: false, restoredLevels: 0, recordLevels: 0 };
  }

  const { spine } = record.state;
  const recordLevels = spine.length;
  const result = applySpine(config, spine);
  const meta = {
    key: options.key,
    name,
    restoredLevels: result.levels,
    recordLevels,
  };

  if (result.levels === 0) {
    logger.warn(MESSAGES.unknownState, { ...meta, value: spine[0].value });
    return { config, restored: false, restoredLevels: 0, recordLevels };
  }
  if (result.levels < recordLevels) {
    logger.warn(MESSAGES.partialHierarchyRestore, meta);
  }
  return {
    config: result.config,
    restored: true,
    restoredLevels: result.levels,
    recordLevels,
  };
}

function validateRestoreOptions(options, name) {
  validateStorageOptions(options, name);
  requireOptionalFunction(options.deserialize, MESSAGES.invalidDeserialize);
  const { maxAgeMs } = options;
  if (maxAgeMs !== undefined && !(Number.isFinite(maxAgeMs) && maxAgeMs >= 0)) {
    throw new Error(MESSAGES.invalidMaxAge);
  }
}

function readKind(config, options, kind) {
  const name = options.name ?? config.name;
  validateRestoreOptions(options, name);
  const logger = options.logger ?? NOOP_LOGGER;
  const record = readRecord(options, name);

  if (record && record.state.kind !== kind) {
    logger.warn(MESSAGES.wrongKind, {
      key: options.key,
      name,
      expectedKind: kind,
      actualKind: record.state.kind,
    });
    return { record: null, name, logger };
  }
  return { record, name, logger };
}

function readRecord(options, name) {
  const { key } = options;
  const logger = options.logger ?? NOOP_LOGGER;

  let raw;
  try {
    raw = options.storage.getItem(key);
  } catch (error) {
    logger.error(MESSAGES.readFailed, { key, name, error });
    return null;
  }
  if (raw === null) {
    logger.debug(MESSAGES.noRecord, { key, name });
    return null;
  }

  let value;
  try {
    value = (options.deserialize ?? JSON.parse)(raw);
  } catch (error) {
    logger.warn(MESSAGES.invalidRecord, {
      key,
      name,
      reason: 'deserialize',
      error,
    });
    return null;
  }

  const record = parseRecord(value);
  if (!record) {
    logger.warn(MESSAGES.invalidRecord, { key, name, reason: 'shape' });
    return null;
  }
  if (record.name !== name) {
    logger.warn(MESSAGES.invalidRecord, {
      key,
      expectedName: name,
      actualName: record.name,
      reason: 'name',
    });
    return null;
  }

  if (options.maxAgeMs !== undefined) {
    let now;
    try {
      now = (options.now ?? Date.now)();
      if (!Number.isFinite(now)) {
        throw new Error('now returned a non-finite timestamp');
      }
    } catch (error) {
      logger.error(MESSAGES.readFailed, { key, name, reason: 'now', error });
      return null;
    }
    if (now - record.at > options.maxAgeMs) {
      logger.warn(MESSAGES.staleRecord, {
        key,
        name,
        at: record.at,
        now,
        maxAgeMs: options.maxAgeMs,
      });
      return null;
    }
  }

  return record;
}

// Reads each known field once and returns the captured values. A custom
// deserialize may return getters that throw (any failure here means "invalid
// shape") or that change between reads, so the record holds what was validated.
function parseRecord(value) {
  try {
    if (!isObject(value)) return null;
    const { format, name, at, state } = value;
    if (format !== 1 || typeof name !== 'string' || !Number.isFinite(at)) {
      return null;
    }
    const parsed = parseState(state);
    return parsed && { format, name, at, state: parsed };
  } catch {
    return null;
  }
}

function parseState(state) {
  if (!isObject(state)) return null;
  const { kind } = state;
  if (kind === 'fsm') {
    const entry = parseEntry(state);
    return entry && { kind, ...entry };
  }
  if (kind === 'hierarchy') return parseSpine(state.spine);
  return null;
}

// Indexed rather than every/map, which skip the holes a custom deserialize can
// leave in a sparse array: a hole reads as undefined and rejects the record.
function parseSpine(spine) {
  const length = Array.isArray(spine) ? spine.length : 0;
  if (length === 0) return null;
  const entries = [];
  for (let index = 0; index < length; index++) {
    const entry = parseEntry(spine[index]);
    if (!entry) return null;
    entries.push(entry);
  }
  return { kind: 'hierarchy', spine: entries };
}

function parseEntry(entry) {
  if (!isObject(entry) || !Object.hasOwn(entry, 'context')) return null;
  const { value, context } = entry;
  return typeof value === 'string' ? { value, context } : null;
}

// Walks the stored spine top-down against the config tree. The first level that
// no longer matches stops the walk: levels above it restore, levels below start fresh.
function applySpine(config, [entry, ...rest]) {
  if (!entry || !hasOwn(config.states, entry.value)) {
    return { config, levels: 0 };
  }

  const restored = { ...config, initial: entry.value, context: entry.context };
  const child = hasOwn(config.children, entry.value)
    ? config.children[entry.value]
    : null;
  if (rest.length === 0 || !isObject(child)) {
    return { config: restored, levels: 1 };
  }

  const inner = applySpine(child, rest);
  if (inner.levels > 0) {
    restored.children = { ...config.children, [entry.value]: inner.config };
  }
  return { config: restored, levels: 1 + inner.levels };
}
