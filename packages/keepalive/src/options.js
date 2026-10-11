export function assertOptions(options) {
  if (typeof options?.probe !== 'function')
    throw new TypeError('probe must be a function');
}
