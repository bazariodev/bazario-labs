import type { FsmConfig, FsmEvent } from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import {
  childConfigFor,
  hasOwn,
  isFiniteNonNegativeNumber,
  isFunction,
  isNonEmptyString,
  isPersistStorage,
  NOOP_LOGGER,
  toPersistRecord,
} from './internal/predicates.js';
import type {
  HierarchyConfigLike,
  PersistedHierarchyState,
  PersistRecord,
  RestoreFsmResult,
  RestoreHierarchyResult,
  RestoreOptions,
} from './types.js';

const defaultDeserialize = (raw: string): unknown => JSON.parse(raw);
const defaultNow = (): number => Date.now();

export function loadRecord(
  options: RestoreOptions & { name: string },
): PersistRecord | null {
  validateRestoreOptions(options, options.name);
  return loadRecordUnchecked(options);
}

export function restoreFsmConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: FsmConfig<TState, TEvent, TContext>,
  options: RestoreOptions,
): RestoreFsmResult<TState, TEvent, TContext> {
  const name = resolveRestoreName(config.name, options.name);
  validateRestoreOptions(options, name);
  const logger = options.logger ?? NOOP_LOGGER;
  const record = loadRecordUnchecked({ ...options, name });

  if (!record) return { config, restored: false };

  if (record.state.kind !== 'fsm') {
    logger.warn(MESSAGES.wrongKind, {
      key: options.key,
      name,
      expectedKind: 'fsm',
      actualKind: record.state.kind,
    });
    return { config, restored: false };
  }

  if (!hasOwn(config.states, record.state.value)) {
    logger.warn(MESSAGES.unknownState, {
      key: options.key,
      name,
      value: record.state.value,
    });
    return { config, restored: false };
  }

  return {
    config: {
      ...config,
      initial: record.state.value as TState,
      context: record.state.context as TContext,
    },
    restored: true,
  };
}

export function restoreHierarchyConfig<TConfig extends HierarchyConfigLike>(
  config: TConfig,
  options: RestoreOptions,
): RestoreHierarchyResult<TConfig> {
  const name = resolveRestoreName(config.name, options.name);
  validateRestoreOptions(options, name);
  const logger = options.logger ?? NOOP_LOGGER;
  const record = loadRecordUnchecked({ ...options, name });

  if (!record) {
    return { config, restored: false, restoredLevels: 0, recordLevels: 0 };
  }

  if (record.state.kind !== 'hierarchy') {
    logger.warn(MESSAGES.wrongKind, {
      key: options.key,
      name,
      expectedKind: 'hierarchy',
      actualKind: record.state.kind,
    });
    return { config, restored: false, restoredLevels: 0, recordLevels: 0 };
  }

  const recordLevels = record.state.spine.length;
  const result = applyHierarchySpine(config, record.state.spine);

  if (result.restoredLevels === 0) {
    logger.warn(MESSAGES.unknownState, {
      key: options.key,
      name,
      value: record.state.spine[0]?.value,
      restoredLevels: 0,
      recordLevels,
    });
    return { config, restored: false, restoredLevels: 0, recordLevels };
  }

  if (result.restoredLevels < recordLevels) {
    logger.warn(MESSAGES.partialHierarchyRestore, {
      key: options.key,
      name,
      restoredLevels: result.restoredLevels,
      recordLevels,
    });
  }

  return {
    config: result.config as TConfig,
    restored: true,
    restoredLevels: result.restoredLevels,
    recordLevels,
  };
}

function loadRecordUnchecked(
  options: RestoreOptions & { name: string },
): PersistRecord | null {
  const logger = options.logger ?? NOOP_LOGGER;
  const deserialize = options.deserialize ?? defaultDeserialize;

  let raw: string | null;
  try {
    raw = options.storage.getItem(options.key);
  } catch (error) {
    logger.error(MESSAGES.readFailed, {
      key: options.key,
      name: options.name,
      error,
    });
    return null;
  }

  if (raw === null) {
    logger.debug(MESSAGES.noRecord, { key: options.key, name: options.name });
    return null;
  }

  let value: unknown;
  try {
    value = deserialize(raw);
  } catch (error) {
    logger.warn(MESSAGES.invalidRecord, {
      key: options.key,
      name: options.name,
      reason: 'deserialize',
      error,
    });
    return null;
  }

  const record = toPersistRecord(value);
  if (!record) {
    logger.warn(MESSAGES.invalidRecord, {
      key: options.key,
      name: options.name,
      reason: 'shape',
    });
    return null;
  }

  if (record.name !== options.name) {
    logger.warn(MESSAGES.invalidRecord, {
      key: options.key,
      expectedName: options.name,
      actualName: record.name,
      reason: 'name',
    });
    return null;
  }

  if (options.maxAgeMs !== undefined) {
    let now: number;
    try {
      now = (options.now ?? defaultNow)();
      if (!Number.isFinite(now)) {
        throw new Error('now returned a non-finite timestamp');
      }
    } catch (error) {
      logger.error(MESSAGES.readFailed, {
        key: options.key,
        name: options.name,
        reason: 'now',
        error,
      });
      return null;
    }

    if (now - record.at > options.maxAgeMs) {
      logger.warn(MESSAGES.staleRecord, {
        key: options.key,
        name: options.name,
        at: record.at,
        now,
        maxAgeMs: options.maxAgeMs,
      });
      return null;
    }
  }

  return record;
}

function applyHierarchySpine(
  config: HierarchyConfigLike,
  spine: PersistedHierarchyState['spine'],
): Readonly<{ config: HierarchyConfigLike; restoredLevels: number }> {
  const [entry, nextEntry] = spine;
  if (!entry || !hasOwn(config.states, entry.value)) {
    return { config, restoredLevels: 0 };
  }

  const restoredConfig: WritableHierarchyConfig = {
    ...config,
    initial: entry.value,
    context: entry.context,
  };

  if (!nextEntry) return { config: restoredConfig, restoredLevels: 1 };

  const childConfig = childConfigFor(config, entry.value);
  if (!childConfig) return { config: restoredConfig, restoredLevels: 1 };

  const childResult = applyHierarchySpine(childConfig, spine.slice(1));
  if (childResult.restoredLevels > 0) {
    restoredConfig.children = {
      ...config.children,
      [entry.value]: childResult.config,
    };
  }

  return {
    config: restoredConfig,
    restoredLevels: 1 + childResult.restoredLevels,
  };
}

type WritableHierarchyConfig = {
  -readonly [K in keyof HierarchyConfigLike]: HierarchyConfigLike[K];
};

function resolveRestoreName(configName: unknown, optionName: unknown): string {
  const name = optionName ?? configName;
  if (!isNonEmptyString(name)) throw new Error(MESSAGES.invalidName);
  return name;
}

function validateRestoreOptions(options: RestoreOptions, name: string): void {
  if (!isPersistStorage(options.storage))
    throw new Error(MESSAGES.invalidStorage);
  if (!isNonEmptyString(options.key)) throw new Error(MESSAGES.invalidKey);
  if (!isNonEmptyString(name)) throw new Error(MESSAGES.invalidName);
  if (options.deserialize !== undefined && !isFunction(options.deserialize)) {
    throw new Error(MESSAGES.invalidDeserialize);
  }
  if (options.now !== undefined && !isFunction(options.now)) {
    throw new Error(MESSAGES.invalidNow);
  }
  if (
    options.maxAgeMs !== undefined &&
    !isFiniteNonNegativeNumber(options.maxAgeMs)
  ) {
    throw new Error(MESSAGES.invalidMaxAge);
  }
}
