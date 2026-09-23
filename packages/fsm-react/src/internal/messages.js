const PREFIX = 'fsm-react';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  deadMachineReturned: `${PREFIX}: create must return a fresh machine after teardown`,
};
