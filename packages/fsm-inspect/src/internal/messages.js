const PREFIX = 'fsm-inspect';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  invalidLimit: `${PREFIX}: limit must be a finite integer >= 1`,
  notAFunction: (option) => `${PREFIX}: ${option} must be a function`,
  invalidRecorder: `${PREFIX}: recorder must be an InspectRecorder`,
  undeclaredState: (state) =>
    `${PREFIX}: diagram references undeclared state "${state}"`,
};
