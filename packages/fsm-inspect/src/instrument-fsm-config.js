import { assertRecorder, capture } from './inspect-recorder.js';

/**
 * Returns a copy of `config` whose transition hooks and state `onEnter` hooks
 * also record to `recorder`. Each wrapper calls the original with the receiver
 * and payload the core passed; everything else, transitions and reducers
 * included, is the original, so the core validates the copy as it would the
 * original.
 */
export function instrumentFsmConfig(config, recorder) {
  assertRecorder(recorder);
  const { name, onTransitionStart, onTransitionBeforeCommit } = config;
  // The core calls the transition hooks with the machine as `this`, and a
  // machine runs one attempt at a time, so each machine built from this config
  // pairs its commit with its own latest start. An attempt that aborts is
  // replaced by the next start, leaving its `transition-start` unmatched.
  const attempts = new WeakMap();

  const states = Object.fromEntries(
    // The core reads only these two hooks, inherited ones included, so they
    // are copied by name rather than spread.
    Object.entries(config.states).map(([state, { onEnter, onLeave }]) => {
      const wrapped = {
        onLeave,
        onEnter(payload) {
          // The core enters the starting state with a null event while it
          // constructs, whichever state the config names as initial by then.
          if (payload.event === null) recordInit(recorder, name, payload);
          onEnter?.call(this, payload);
        },
      };
      return [state, wrapped];
    }),
  );

  return {
    ...config,
    states,
    onTransitionStart(payload) {
      const attemptId = recorder.nextAttemptId();
      attempts.set(this, attemptId);
      recordTransitionStart(recorder, name, attemptId, payload);
      onTransitionStart?.call(this, payload);
    },
    onTransitionBeforeCommit(payload) {
      recordTransition(recorder, name, attempts.get(this), payload);
      onTransitionBeforeCommit?.call(this, payload);
    },
  };
}

function recordInit(recorder, name, { to, context }) {
  capture(recorder, (at, { mapContext }) => ({
    type: 'init',
    at,
    name,
    state: to,
    context: mapContext(context),
  }));
}

function recordTransitionStart(recorder, name, attemptId, payload) {
  const { from, to, event, context } = payload;
  capture(recorder, (at, { mapContext, mapEvent }) => ({
    type: 'transition-start',
    at,
    name,
    attemptId,
    from,
    to,
    eventType: event.type,
    event: mapEvent(event),
    contextBefore: mapContext(context),
  }));
}

function recordTransition(recorder, name, attemptId, payload) {
  const { from, to, event, previousContext, nextContext } = payload;
  capture(recorder, (at, { mapContext, mapEvent }) => ({
    type: 'transition',
    at,
    name,
    attemptId,
    from,
    to,
    eventType: event.type,
    event: mapEvent(event),
    contextBefore: mapContext(previousContext),
    contextAfter: mapContext(nextContext),
  }));
}
