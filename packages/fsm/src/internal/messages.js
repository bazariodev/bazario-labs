const PREFIX = 'fsm';

/** Centralized diagnostic strings. Tests assert the literals against these. */
export const MESSAGES = {
  // runtime
  sendWhileLocked: `${PREFIX}: cannot call send() while a transition is in progress`,
  transitionRejected: `${PREFIX}: transition rejected`,
  subscriberNotificationFailed: `${PREFIX}: subscriber notification failed`,

  // config validation
  nameEmpty: `${PREFIX}: name must not be empty`,
  wildcardReservedState: `${PREFIX}: "*" is reserved and cannot be used as a state name`,
  transitionEntryEmpty: (source, eventType) =>
    `${PREFIX}: transition entry "${source}.${eventType}" must include at least one definition`,
  initialStateMissing: (initial) =>
    `${PREFIX}: initial state "${initial}" must exist in states`,
  transitionSourceMissing: (source) =>
    `${PREFIX}: transition source state "${source}" must exist in states`,
  transitionTargetMissing: (target) =>
    `${PREFIX}: transition target "${target}" must exist in states`,
};
