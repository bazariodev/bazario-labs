import type {
  ContextReducer,
  FsmConfig,
  FsmEvent,
  StateDefinition,
  StateEnterPayload,
  StateLeavePayload,
  TransitionCommitPayload,
  TransitionDefinition,
  TransitionEntry,
  TransitionMap,
  TransitionStartPayload,
} from '@bazariodev/fsm';
import {
  assertRecorder,
  type InspectRecorder,
  mapContextFor,
  mapEventFor,
  timestampFor,
} from './inspect-recorder.js';
import { MESSAGES } from './internal/messages.js';
import { hasOwn, isFunction, isRecord } from './internal/predicates.js';

export function instrumentFsmConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: FsmConfig<TState, TEvent, TContext>,
  recorder: InspectRecorder,
): FsmConfig<TState, TEvent, TContext> {
  validateConfig(config);
  assertRecorder(recorder);

  const originalStart = config.onTransitionStart;
  const originalBeforeCommit = config.onTransitionBeforeCommit;
  const attemptStack: number[] = [];
  const states = wrapStates(config, recorder, attemptStack);
  const transitions = wrapTransitions(config.transitions, attemptStack);

  return {
    ...config,
    states,
    transitions,
    onTransitionStart: (
      payload: TransitionStartPayload<TState, TEvent, TContext>,
    ) => {
      const attemptId = recorder.nextAttemptId();
      attemptStack.push(attemptId);
      recordTransitionStart(config.name, recorder, attemptId, payload);
      try {
        originalStart?.(payload);
      } catch (error) {
        removeLatestAttempt(attemptStack, attemptId);
        throw error;
      }
    },
    onTransitionBeforeCommit: (
      payload: TransitionCommitPayload<TState, TEvent, TContext>,
    ) => {
      const attemptId = attemptStack.pop() ?? recorder.nextAttemptId();
      recordTransition(config.name, recorder, attemptId, payload);
      originalBeforeCommit?.(payload);
    },
  };
}

function validateConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(config: FsmConfig<TState, TEvent, TContext>): void {
  if (
    !isRecord(config) ||
    typeof config.name !== 'string' ||
    typeof config.initial !== 'string' ||
    !isRecord(config.states) ||
    !hasOwn(config.states, config.initial)
  ) {
    throw new Error(MESSAGES.invalidConfig);
  }

  if (
    (config.onTransitionStart !== undefined &&
      !isFunction(config.onTransitionStart)) ||
    (config.onTransitionBeforeCommit !== undefined &&
      !isFunction(config.onTransitionBeforeCommit))
  ) {
    throw new Error(MESSAGES.invalidConfig);
  }

  for (const state of Object.values(config.states)) {
    if (
      !isRecord(state) ||
      (state.onEnter !== undefined && !isFunction(state.onEnter)) ||
      (state.onLeave !== undefined && !isFunction(state.onLeave))
    ) {
      throw new Error(MESSAGES.invalidConfig);
    }
  }
}

function wrapStates<TState extends string, TEvent extends FsmEvent, TContext>(
  config: FsmConfig<TState, TEvent, TContext>,
  recorder: InspectRecorder,
  attemptStack: number[],
): Record<TState, StateDefinition<TState, TEvent, TContext>> {
  const states = {} as Record<
    TState,
    StateDefinition<TState, TEvent, TContext>
  >;

  for (const state of Object.keys(config.states) as TState[]) {
    const definition = config.states[state];
    if (!definition) throw new Error(MESSAGES.invalidConfig);

    states[state] = wrapState(
      config.name,
      definition,
      state === config.initial,
      recorder,
      attemptStack,
    );
  }

  return states;
}

function wrapState<TState extends string, TEvent extends FsmEvent, TContext>(
  name: string,
  definition: StateDefinition<TState, TEvent, TContext>,
  isInitial: boolean,
  recorder: InspectRecorder,
  attemptStack: number[],
): StateDefinition<TState, TEvent, TContext> {
  const originalEnter = definition.onEnter;
  const originalLeave = definition.onLeave;

  return {
    ...definition,
    ...(originalEnter || isInitial
      ? {
          onEnter: (payload: StateEnterPayload<TState, TEvent, TContext>) => {
            if (isInitial && payload.event === null) {
              recordInit(name, recorder, payload);
              originalEnter?.(payload);
              return;
            }

            try {
              originalEnter?.(payload);
            } catch (error) {
              attemptStack.pop();
              throw error;
            }
          },
        }
      : {}),
    ...(originalLeave
      ? {
          onLeave: (payload: StateLeavePayload<TState, TEvent, TContext>) => {
            try {
              originalLeave(payload);
            } catch (error) {
              attemptStack.pop();
              throw error;
            }
          },
        }
      : {}),
  };
}

function wrapTransitions<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  transitions: TransitionMap<TState, TEvent, TContext>,
  attemptStack: number[],
): TransitionMap<TState, TEvent, TContext> {
  const wrapped = {} as Partial<
    Record<
      TState | '*',
      Partial<Record<TEvent['type'], TransitionEntry<TState, TEvent, TContext>>>
    >
  >;

  for (const source of Object.keys(transitions) as Array<TState | '*'>) {
    const eventMap = transitions[source];
    if (eventMap === undefined) continue;
    const wrappedEventMap: Partial<
      Record<TEvent['type'], TransitionEntry<TState, TEvent, TContext>>
    > = {};

    for (const eventType of Object.keys(eventMap) as Array<TEvent['type']>) {
      const entry = eventMap[eventType];
      if (entry === undefined) continue;
      wrappedEventMap[eventType] = wrapTransitionEntry(entry, attemptStack);
    }

    wrapped[source] = wrappedEventMap;
  }

  return wrapped as TransitionMap<TState, TEvent, TContext>;
}

function wrapTransitionEntry<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  entry: TransitionEntry<TState, TEvent, TContext>,
  attemptStack: number[],
): TransitionEntry<TState, TEvent, TContext> {
  if (Array.isArray(entry)) {
    return (
      entry as ReadonlyArray<TransitionDefinition<TState, TEvent, TContext>>
    ).map((definition) => wrapTransitionDefinition(definition, attemptStack));
  }

  return wrapTransitionDefinition(
    entry as TransitionDefinition<TState, TEvent, TContext>,
    attemptStack,
  );
}

function wrapTransitionDefinition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  definition: TransitionDefinition<TState, TEvent, TContext>,
  attemptStack: number[],
): TransitionDefinition<TState, TEvent, TContext> {
  const reducer = definition.reducer;
  if (!isFunction(reducer)) return definition;

  return {
    ...definition,
    reducer: ((context, event) => {
      try {
        return reducer(context, event);
      } catch (error) {
        attemptStack.pop();
        throw error;
      }
    }) as ContextReducer<TContext, TEvent>,
  };
}

function removeLatestAttempt(attemptStack: number[], attemptId: number): void {
  const index = attemptStack.lastIndexOf(attemptId);
  if (index !== -1) attemptStack.splice(index, 1);
}

function recordInit<TState extends string, TEvent extends FsmEvent, TContext>(
  name: string,
  recorder: InspectRecorder,
  payload: StateEnterPayload<TState, TEvent, TContext>,
): void {
  const at = timestampFor(recorder);
  if (at === null) return;

  try {
    recorder.record({
      type: 'init',
      at,
      name,
      state: payload.to,
      context: mapContextFor(recorder, payload.context),
    });
  } catch {
    // Redaction hooks are diagnostic-only and must not affect construction.
  }
}

function recordTransitionStart<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  name: string,
  recorder: InspectRecorder,
  attemptId: number,
  payload: TransitionStartPayload<TState, TEvent, TContext>,
): void {
  const at = timestampFor(recorder);
  if (at === null) return;

  try {
    recorder.record({
      type: 'transition-start',
      at,
      name,
      attemptId,
      from: payload.from,
      to: payload.to,
      eventType: payload.event.type,
      event: mapEventFor(recorder, payload.event),
      contextBefore: mapContextFor(recorder, payload.context),
    });
  } catch {
    // Redaction hooks are diagnostic-only and must not affect send().
  }
}

function recordTransition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  name: string,
  recorder: InspectRecorder,
  attemptId: number,
  payload: TransitionCommitPayload<TState, TEvent, TContext>,
): void {
  const at = timestampFor(recorder);
  if (at === null) return;

  try {
    recorder.record({
      type: 'transition',
      at,
      name,
      attemptId,
      from: payload.from,
      to: payload.to,
      eventType: payload.event.type,
      event: mapEventFor(recorder, payload.event),
      contextBefore: mapContextFor(recorder, payload.previousContext),
      contextAfter: mapContextFor(recorder, payload.nextContext),
    });
  } catch {
    // Redaction hooks are diagnostic-only and must not affect send().
  }
}
