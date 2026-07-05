import type {
  HierarchyConfigLike,
  Logger,
  PersistedHierarchyState,
  PersistedState,
  PersistRecord,
  PersistStorage,
} from '../types.js';

export const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function isObject(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasOwn<T extends PropertyKey>(
  value: unknown,
  key: T,
): value is Record<T, unknown> {
  return isObject(value) && Object.hasOwn(value, key);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFunction(
  value: unknown,
): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

export function isPersistStorage(value: unknown): value is PersistStorage {
  return (
    isObject(value) &&
    isFunction(value.getItem) &&
    isFunction(value.setItem) &&
    isFunction(value.removeItem)
  );
}

export function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function toPersistRecord(value: unknown): PersistRecord | null {
  try {
    if (!isObject(value)) return null;

    const format = value.format;
    const name = value.name;
    const at = value.at;
    const state = toPersistedState(value.state);

    if (
      format !== 1 ||
      typeof name !== 'string' ||
      typeof at !== 'number' ||
      !Number.isFinite(at) ||
      !state
    ) {
      return null;
    }

    return { format, name, at, state };
  } catch {
    return null;
  }
}

export function childConfigFor(
  config: HierarchyConfigLike,
  value: string,
): HierarchyConfigLike | null {
  if (!isObject(config.children) || !hasOwn(config.children, value))
    return null;
  const child = config.children[value];
  return isHierarchyConfigLike(child) ? child : null;
}

export function isHierarchyConfigLike(
  value: unknown,
): value is HierarchyConfigLike {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.initial === 'string' &&
    hasOwn(value, 'context') &&
    isObject(value.states)
  );
}

function toPersistedState(value: unknown): PersistedState | null {
  try {
    if (!isObject(value)) return null;

    if (value.kind === 'fsm') {
      if (typeof value.value !== 'string' || !hasOwn(value, 'context')) {
        return null;
      }

      return {
        kind: 'fsm',
        value: value.value,
        context: value.context,
      };
    }

    if (value.kind === 'hierarchy') {
      if (!Array.isArray(value.spine) || value.spine.length === 0) return null;

      const spine: PersistedHierarchyState['spine'] = value.spine.map(
        (entry) => {
          if (
            !isObject(entry) ||
            typeof entry.value !== 'string' ||
            !hasOwn(entry, 'context')
          ) {
            throw new Error('invalid persisted hierarchy spine entry');
          }

          return {
            value: entry.value,
            context: entry.context,
          };
        },
      );

      return { kind: 'hierarchy', spine };
    }

    return null;
  } catch {
    return null;
  }
}
