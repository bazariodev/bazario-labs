import { assertDuration } from './guards.js';

const defaultRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export function normalizeOptions(options) {
  const {
    channel,
    createRequestId = defaultRequestId,
    timeoutMs = 10_000,
    readyTimeoutMs = 10_000,
    maxPending = 100,
    logger = { error() {} },
  } = options ?? {};
  for (const method of ['send', 'onMessage', 'subscribe']) {
    if (typeof channel?.[method] !== 'function')
      throw new TypeError(`channel.${method} must be a function`);
  }
  if (typeof createRequestId !== 'function')
    throw new TypeError('createRequestId must be a function');
  assertDuration(timeoutMs);
  assertDuration(readyTimeoutMs);
  if (!Number.isSafeInteger(maxPending) || maxPending < 1)
    throw new RangeError('maxPending must be a positive integer');
  return {
    channel,
    createRequestId,
    timeoutMs,
    readyTimeoutMs,
    maxPending,
    logger,
    scheduler: options.scheduler ?? scheduler,
  };
}
