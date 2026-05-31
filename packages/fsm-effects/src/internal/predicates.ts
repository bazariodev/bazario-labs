import type { Logger } from '@bazariodev/fsm';

export const WILDCARD: '*' = '*';

export const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const hasOwn = <TObject extends object>(
  object: TObject,
  key: PropertyKey,
): key is keyof TObject => Object.hasOwn(object, key);
