const PREFIX = 'fsm-effects';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  effectThrew: `${PREFIX}: effect threw`,
  effectRejectedAfterAbort: `${PREFIX}: effect rejected after abort`,
  effectRejected: `${PREFIX}: effect rejected`,
  cleanupThrew: `${PREFIX}: cleanup threw`,
  effectsNotObject: `${PREFIX}: effects must be an object`,

  entryNotFunctionOrArray: (key: string): string =>
    `${PREFIX}: effects["${key}"] must be a function or array of functions`,
  arrayEntryNotFunction: (key: string, index: number): string =>
    `${PREFIX}: effects["${key}"][${index}] must be a function`,
} as const;
