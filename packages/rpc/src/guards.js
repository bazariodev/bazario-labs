const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const hasId = (message) =>
  typeof message?.id === 'string' && message.id.length > 0;
export const isResponse = (message) =>
  isObject(message) &&
  (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'));
export const isNotification = (message) =>
  isObject(message) &&
  !Object.hasOwn(message, 'id') &&
  typeof message.method === 'string' &&
  message.method.length > 0 &&
  !Object.hasOwn(message, 'result') &&
  !Object.hasOwn(message, 'error');

export function isErrorData(error) {
  if (!isObject(error)) return false;
  const { code, message } = error;
  return (
    ((typeof code === 'string' && code.length > 0) || Number.isFinite(code)) &&
    (message === undefined || typeof message === 'string')
  );
}

export function assertRequest(request) {
  if (
    !isObject(request) ||
    typeof request.method !== 'string' ||
    !request.method
  )
    throw new TypeError('request.method must be a non-empty string');
}

export function assertDuration(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)
    throw new RangeError(
      'RPC timeout must be a positive integer timer duration',
    );
}

export function assertRequestOptions({ signal, onWillSend }) {
  if (onWillSend !== undefined && typeof onWillSend !== 'function')
    throw new TypeError('onWillSend must be a function');
  if (
    signal !== undefined &&
    (typeof signal?.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  )
    throw new TypeError('signal must be an AbortSignal');
}
