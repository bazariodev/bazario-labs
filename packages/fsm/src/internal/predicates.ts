import type { Logger } from '../types.js';

export const WILDCARD_STATE: '*' = '*';

export const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const hasOwn = <TObject extends object>(
  object: TObject,
  key: PropertyKey,
): key is keyof TObject => Object.hasOwn(object, key);

export const isRecord = (
  value: unknown,
): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
