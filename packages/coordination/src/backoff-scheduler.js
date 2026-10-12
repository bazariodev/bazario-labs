const MAX_TIMER_MS = 2_147_483_647;

export const defaultScheduler = Object.freeze({
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle);
  },
});

export function createBackoffScheduler(options = {}) {
  const {
    initialDelayMs = 500,
    maxDelayMs = 30_000,
    factor = 2,
    scheduler = defaultScheduler,
    jitter = {},
  } = options;

  assertDelay(initialDelayMs, 'initialDelayMs');
  assertDelay(maxDelayMs, 'maxDelayMs');
  if (maxDelayMs < initialDelayMs) {
    throw new RangeError(
      'maxDelayMs must be greater than or equal to initialDelayMs',
    );
  }
  if (!Number.isFinite(factor) || factor < 1) {
    throw new RangeError(
      'factor must be a finite number greater than or equal to 1',
    );
  }
  if (
    typeof scheduler?.setTimeout !== 'function' ||
    typeof scheduler?.clearTimeout !== 'function'
  ) {
    throw new TypeError(
      'scheduler must provide setTimeout and clearTimeout functions',
    );
  }

  const jitterOptions = normalizeJitter(jitter);

  return Object.freeze({
    schedule(attempt, callback) {
      if (!Number.isInteger(attempt) || attempt < 1) {
        throw new RangeError('attempt must be a positive integer');
      }
      if (typeof callback !== 'function') {
        throw new TypeError('callback must be a function');
      }

      const baseDelay = Math.min(
        maxDelayMs,
        initialDelayMs * factor ** (attempt - 1),
      );
      const ratio = jitterOptions.disabled ? 1 : selectRatio(jitterOptions);
      const delayMs = Math.min(maxDelayMs, Math.floor(baseDelay * ratio));
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

function assertDelay(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_MS) {
    throw new RangeError(`${name} must be an integer in [1, ${MAX_TIMER_MS}]`);
  }
}

function normalizeJitter(jitter) {
  if (jitter === false) return { disabled: true };
  if (jitter === null || typeof jitter !== 'object') {
    throw new TypeError('jitter must be false or an options object');
  }

  const { minRatio = 0, maxRatio = 1, random = Math.random } = jitter;
  if (!Number.isFinite(minRatio) || minRatio < 0) {
    throw new RangeError('minRatio must be a finite nonnegative number');
  }
  if (!Number.isFinite(maxRatio) || maxRatio < minRatio) {
    throw new RangeError(
      'maxRatio must be a finite number greater than or equal to minRatio',
    );
  }
  if (typeof random !== 'function') {
    throw new TypeError('random must be a function');
  }
  return { minRatio, maxRatio, random };
}

function selectRatio({ minRatio, maxRatio, random }) {
  if (minRatio === maxRatio) return minRatio;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('random must return a number in [0, 1)');
  }
  return minRatio + value * (maxRatio - minRatio);
}
