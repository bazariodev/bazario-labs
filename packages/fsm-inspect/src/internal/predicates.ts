import type { Logger } from '../types.js';

export const WILDCARD_STATE: '*' = '*';

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

export function isRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  return isObject(value) && !Array.isArray(value);
}

export function isFunction(
  value: unknown,
): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasOwn<T extends PropertyKey>(
  value: unknown,
  key: T,
): value is Record<T, unknown> {
  return isObject(value) && Object.hasOwn(value, key);
}
