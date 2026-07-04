const PREFIX = 'fsm-hierarchy';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  eventRejected: `${PREFIX}: event rejected`,
  nodeCleanupFailed: `${PREFIX}: node cleanup failed`,
  nodeConstructionFailed: `${PREFIX}: node construction failed`,
  nodeSpawnCallbackFailed: `${PREFIX}: node spawn callback failed`,
  nodeSubscriberFailed: `${PREFIX}: node subscriber failed`,
  rootNotInitialized: `${PREFIX}: root is not initialized`,
  sendWhileReconciling: `${PREFIX}: cannot send while reconciliation is in progress`,
  snapshotNotInitialized: `${PREFIX}: snapshot is not initialized`,
  subscriberFailed: `${PREFIX}: subscriber failed`,

  childConfigNotObject: `${PREFIX}: child config must be an object`,
  childKeyMissing: `${PREFIX}: child key must reference a declared state`,
  childrenNotObject: `${PREFIX}: children must be an object`,
  configNameNonEmpty: `${PREFIX}: config name must be a non-empty string`,
  initialStateMissing: `${PREFIX}: initial state must reference a declared state`,
  initialStateString: `${PREFIX}: initial state must be a string`,
  stateDefinitionsObject: `${PREFIX}: state definitions must be objects`,
  stateNamesNoDot: `${PREFIX}: state names cannot contain "."`,
  statesNotObject: `${PREFIX}: states must be an object`,
  transitionEntryEmpty: `${PREFIX}: transition entry must include at least one definition`,
  transitionGuardFunction: `${PREFIX}: transition guard must be a function`,
  transitionReducerFunction: `${PREFIX}: transition reducer must be a function`,
  transitionSourceEventMap: `${PREFIX}: transition source must define an event map`,
  transitionSourceMissing: `${PREFIX}: transition source must reference a declared state`,
  transitionTargetMissing: `${PREFIX}: transition target must reference a declared state`,
  transitionsNotObject: `${PREFIX}: transitions must be an object`,
  wildcardReservedState: `${PREFIX}: "*" cannot be used as a state name`,

  stateOnEnterNotFunction: (state: string): string =>
    `${PREFIX}: state "${state}" onEnter must be a function`,
  stateOnLeaveNotFunction: (state: string): string =>
    `${PREFIX}: state "${state}" onLeave must be a function`,
} as const;
