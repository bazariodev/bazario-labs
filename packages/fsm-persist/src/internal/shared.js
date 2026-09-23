import { MESSAGES } from './messages.js';

export const isObject = (value) => typeof value === 'object' && value !== null;

export const hasOwn = (value, key) =>
  isObject(value) && Object.hasOwn(value, key);

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

// The default logger is a no-op and every storage call is contained, so a
// misconfigured option would silently disable persistence. Fail fast instead.
export function validateStorageOptions(options, name) {
  const { storage } = options;
  if (
    !isObject(storage) ||
    typeof storage.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function'
  ) {
    throw new Error(MESSAGES.invalidStorage);
  }
  if (!isNonEmptyString(options.key)) throw new Error(MESSAGES.invalidKey);
  if (!isNonEmptyString(name)) throw new Error(MESSAGES.invalidName);
  requireOptionalFunction(options.now, MESSAGES.invalidNow);
}

export function requireOptionalFunction(value, message) {
  if (value !== undefined && typeof value !== 'function') {
    throw new Error(message);
  }
}
