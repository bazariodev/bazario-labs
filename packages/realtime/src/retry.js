const DEFAULT_SCHEDULER = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

const MAX_TIMER_MS = 2_147_483_647;

export function createRetry(options = {}) {
  const {
    initialDelayMs = 500,
    maxDelayMs = 30_000,
    factor = 2,
    random = Math.random,
    scheduler = DEFAULT_SCHEDULER,
  } = options;
  assertOptions(initialDelayMs, maxDelayMs, factor, random, scheduler);

  return Object.freeze({
    schedule(attempt, callback) {
      if (!Number.isInteger(attempt) || attempt < 1)
        throw new RangeError('attempt must be a positive integer');
      if (typeof callback !== 'function')
        throw new TypeError('callback must be a function');

      const ceiling = Math.min(
        maxDelayMs,
        initialDelayMs * factor ** (attempt - 1),
      );
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1)
        throw new RangeError('random must return a number in [0, 1)');
      const delayMs = Math.floor(value * ceiling);

      let active = true;
      const handle = scheduler.setTimeout(() => {
        if (!active) return;
        active = false;
        callback();
      }, delayMs);
      return () => {
        if (!active) return;
        active = false;
        scheduler.clearTimeout(handle);
      };
    },
  });
}

function assertOptions(initialDelayMs, maxDelayMs, factor, random, scheduler) {
  if (
    !validDuration(initialDelayMs) ||
    !validDuration(maxDelayMs) ||
    maxDelayMs < initialDelayMs ||
    !Number.isFinite(factor) ||
    factor < 1
  )
    throw new RangeError('Invalid retry delay options');
  if (typeof random !== 'function')
    throw new TypeError('random must be a function');
  if (
    typeof scheduler?.setTimeout !== 'function' ||
    typeof scheduler?.clearTimeout !== 'function'
  )
    throw new TypeError('scheduler must provide setTimeout and clearTimeout');
}

function validDuration(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TIMER_MS;
}
