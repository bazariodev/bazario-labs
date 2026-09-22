const PREFIX = 'fsm-delays';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  delaysNotObject: `${PREFIX}: delays must be a plain object`,
  skipped: {
    after: `${PREFIX}: skipped "after" with invalid duration`,
    every: `${PREFIX}: skipped "every" with invalid interval`,
  },
  delayedSendThrew: `${PREFIX}: delayed send threw`,

  path: (state, index) => `${PREFIX}: delays["${state}"][${index}]`,
  notDelaySpec: (path) => `${path} must be a delay spec`,
  oneOfAfterEvery: (path) =>
    `${path} must have exactly one of "after" or "every"`,
  missingSend: (path) => `${path} is missing "send"`,
  invalidDuration: (path, kind) =>
    `${path}.${kind} must be a finite number ${kind === 'after' ? '>= 0' : '> 0'}`,
};
