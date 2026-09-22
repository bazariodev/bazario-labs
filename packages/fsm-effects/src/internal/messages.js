const PREFIX = 'fsm-effects';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  effectThrew: `${PREFIX}: effect threw`,
  effectRejectedAfterAbort: `${PREFIX}: effect rejected after abort`,
  effectRejected: `${PREFIX}: effect rejected`,
  cleanupThrew: `${PREFIX}: cleanup threw`,
  effectsNotObject: `${PREFIX}: effects must be a plain object`,
  effectNotFunction: (key) =>
    `${PREFIX}: effects["${key}"] must be a function or an array of functions`,
};
