const PREFIX = 'fsm';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  // lifecycle / runtime
  initialized: `${PREFIX}: initialized`,
  sendWhileLocked: `${PREFIX}: cannot call send() while a transition is in progress`,
  transitionRejected: `${PREFIX}: transition rejected`,
  transitionStartHookFailed: `${PREFIX}: transition start hook failed`,
  stateLeaveHookFailed: `${PREFIX}: state leave hook failed`,
  stateEnterHookFailed: `${PREFIX}: state enter hook failed`,
  transitionBeforeCommitHookFailed: `${PREFIX}: transition before commit hook failed`,
  contextReducerFailed: `${PREFIX}: context reducer failed`,
  subscriberNotificationFailed: `${PREFIX}: subscriber notification failed`,
  guardEvaluationFailed: `${PREFIX}: guard evaluation failed`,
  initialEnterHookFailed: `${PREFIX}: initial enter hook failed`,

  // config validation — static
  statesNotObject: `${PREFIX}: states must be an object`,
  transitionsNotObject: `${PREFIX}: transitions must be an object`,
  nameEmpty: `${PREFIX}: name must not be empty`,
  wildcardReservedState: `${PREFIX}: "*" is reserved and cannot be used as a state name`,
  wildcardTarget: `${PREFIX}: "*" cannot be used as a transition target`,

  // config validation — builders
  transitionNotObject: (path: string): string =>
    `${PREFIX}: transition definition "${path}" must be an object`,
  transitionMissingTarget: (path: string): string =>
    `${PREFIX}: transition definition "${path}" must include target`,
  transitionTargetNotString: (path: string): string =>
    `${PREFIX}: transition definition "${path}" target must be a string`,
  transitionGuardNotFunction: (path: string): string =>
    `${PREFIX}: transition definition "${path}" guard must be a function`,
  transitionReducerNotFunction: (path: string): string =>
    `${PREFIX}: transition definition "${path}" reducer must be a function`,
  stateNotObject: (key: string): string =>
    `${PREFIX}: state definition "${key}" must be an object`,
  stateOnEnterNotFunction: (key: string): string =>
    `${PREFIX}: state definition "${key}" onEnter must be a function`,
  stateOnLeaveNotFunction: (key: string): string =>
    `${PREFIX}: state definition "${key}" onLeave must be a function`,
  transitionSourceNoEventMap: (source: string): string =>
    `${PREFIX}: transition source "${source}" must define an event map`,
  transitionEntryEmpty: (source: string, eventType: string): string =>
    `${PREFIX}: transition entry "${source}.${eventType}" must include at least one definition`,
  initialStateMissing: (initial: string): string =>
    `${PREFIX}: initial state "${initial}" must exist in states`,
  transitionSourceMissing: (source: string): string =>
    `${PREFIX}: transition source state "${source}" must exist in states`,
  transitionTargetMissing: (target: string): string =>
    `${PREFIX}: transition target "${target}" must exist in states`,
} as const;
