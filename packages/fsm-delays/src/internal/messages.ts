const PREFIX = 'fsm-delays';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  delaysNotObject: `${PREFIX}: delays must be an object`,
  skippedAfter: `${PREFIX}: skipped "after" with invalid duration`,
  skippedEvery: `${PREFIX}: skipped "every" with invalid interval`,
  delayedSendThrew: `${PREFIX}: delayed send threw`,

  path: (state: string, index: number): string =>
    `${PREFIX}: delays["${state}"][${index}]`,
  notDelaySpec: (path: string): string => `${path} must be a delay spec`,
  oneOfAfterEvery: (path: string): string =>
    `${path} must have exactly one of "after" or "every"`,
  missingSend: (path: string): string => `${path} is missing "send"`,
  invalidAfter: (path: string): string =>
    `${path}.after must be a finite number >= 0`,
  invalidEvery: (path: string): string =>
    `${path}.every must be a finite number > 0`,
} as const;
