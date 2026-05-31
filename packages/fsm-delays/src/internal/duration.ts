export const isValidAfter = (ms: number): boolean =>
  Number.isFinite(ms) && ms >= 0;

export const isValidEvery = (ms: number): boolean =>
  Number.isFinite(ms) && ms > 0;
