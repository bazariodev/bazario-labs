export function createJitter({ minMs, maxMs, random = Math.random }) {
  if (
    !Number.isInteger(minMs) ||
    !Number.isInteger(maxMs) ||
    minMs < 1 ||
    maxMs < minMs ||
    maxMs > 2_147_483_647
  )
    throw new RangeError(
      'Jitter bounds must be ordered positive integer timer durations',
    );
  if (typeof random !== 'function')
    throw new TypeError('random must be a function');
  return () => {
    if (minMs === maxMs) return minMs;
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
      throw new RangeError('random must return a number in [0, 1)');
    return minMs + Math.floor(draw * (maxMs - minMs + 1));
  };
}
