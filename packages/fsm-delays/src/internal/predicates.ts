import type { Logger } from '@bazariodev/fsm';

export const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const hasOwn = <TObject extends object>(
  object: TObject,
  key: PropertyKey,
): key is keyof TObject => Object.hasOwn(object, key);

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
