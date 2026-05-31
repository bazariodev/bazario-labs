import type {
  FsmConfig,
  FsmEvent,
  StateDefinition,
  TransitionDefinition,
  TransitionMap,
} from '../types.js';
import { MESSAGES } from './messages.js';
import { hasOwn, isRecord, WILDCARD_STATE } from './predicates.js';

export type TransitionSource<TState extends string> =
  | TState
  | typeof WILDCARD_STATE;

export type TransitionBucket<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Partial<
  Record<
    TEvent['type'],
    ReadonlyArray<TransitionDefinition<TState, TEvent, TContext>>
  >
>;

export type NormalizedTransitionMap<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Partial<
  Record<TransitionSource<TState>, TransitionBucket<TState, TEvent, TContext>>
>;

export type NormalizedStateMap<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<Record<TState, StateDefinition<TState, TEvent, TContext>>>;

function normalizeTransitionDefinition<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  source: string,
  eventType: string,
  index: number,
  definition: unknown,
): TransitionDefinition<TState, TEvent, TContext> {
  const path = `${source}.${eventType}[${index}]`;

  if (!isRecord(definition)) {
    throw new Error(MESSAGES.transitionNotObject(path));
  }

  if (!hasOwn(definition, 'target')) {
    throw new Error(MESSAGES.transitionMissingTarget(path));
  }

  if (typeof definition.target !== 'string') {
    throw new Error(MESSAGES.transitionTargetNotString(path));
  }

  if (
    hasOwn(definition, 'guard') &&
    definition.guard !== undefined &&
    typeof definition.guard !== 'function'
  ) {
    throw new Error(MESSAGES.transitionGuardNotFunction(path));
  }

  if (
    hasOwn(definition, 'reducer') &&
    definition.reducer !== undefined &&
    typeof definition.reducer !== 'function'
  ) {
    throw new Error(MESSAGES.transitionReducerNotFunction(path));
  }

  return Object.freeze({
    target: definition.target,
    guard: definition.guard,
    reducer: definition.reducer,
  }) as TransitionDefinition<TState, TEvent, TContext>;
}

export function normalizeStates<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(states: unknown): NormalizedStateMap<TState, TEvent, TContext> {
  if (!isRecord(states)) throw new Error(MESSAGES.statesNotObject);

  const normalized = {} as Record<
    TState,
    StateDefinition<TState, TEvent, TContext>
  >;

  for (const key in states) {
    if (!hasOwn(states, key)) continue;

    const definition = states[key];
    if (!isRecord(definition)) {
      throw new Error(MESSAGES.stateNotObject(key));
    }

    const { onEnter, onLeave } = definition;

    if (onEnter !== undefined && typeof onEnter !== 'function') {
      throw new Error(MESSAGES.stateOnEnterNotFunction(key));
    }

    if (onLeave !== undefined && typeof onLeave !== 'function') {
      throw new Error(MESSAGES.stateOnLeaveNotFunction(key));
    }

    normalized[key as TState] = Object.freeze({
      onEnter,
      onLeave,
    } as StateDefinition<TState, TEvent, TContext>);
  }

  return Object.freeze(normalized);
}

export function normalizeTransitions<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  transitions: TransitionMap<TState, TEvent, TContext>,
): NormalizedTransitionMap<TState, TEvent, TContext> {
  if (!isRecord(transitions)) throw new Error(MESSAGES.transitionsNotObject);

  const normalized: NormalizedTransitionMap<TState, TEvent, TContext> = {};

  for (const source in transitions) {
    if (!hasOwn(transitions, source)) continue;

    const eventMap = transitions[source];
    if (!isRecord(eventMap)) {
      throw new Error(MESSAGES.transitionSourceNoEventMap(source));
    }

    const bucket: TransitionBucket<TState, TEvent, TContext> = {};

    for (const eventType in eventMap) {
      if (!hasOwn(eventMap, eventType)) continue;

      const entry = eventMap[eventType];
      const definitions = Array.isArray(entry) ? [...entry] : [entry];

      if (definitions.length === 0) {
        throw new Error(MESSAGES.transitionEntryEmpty(source, eventType));
      }

      bucket[eventType as TEvent['type']] = definitions.map(
        (definition, index) =>
          normalizeTransitionDefinition<TState, TEvent, TContext>(
            source,
            eventType,
            index,
            definition,
          ),
      );
    }

    normalized[source as TransitionSource<TState>] = bucket;
  }

  return normalized;
}

export function validateConfig<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: FsmConfig<TState, TEvent, TContext>,
  states: NormalizedStateMap<TState, TEvent, TContext>,
  transitions: NormalizedTransitionMap<TState, TEvent, TContext>,
): void {
  if (!config.name.trim()) throw new Error(MESSAGES.nameEmpty);

  if (hasOwn(states, WILDCARD_STATE)) {
    throw new Error(MESSAGES.wildcardReservedState);
  }

  if (!hasOwn(states, config.initial)) {
    throw new Error(MESSAGES.initialStateMissing(config.initial));
  }

  for (const source in transitions) {
    if (!hasOwn(transitions, source)) continue;

    const eventMap = transitions[source];
    if (eventMap === undefined) continue;

    if (source !== WILDCARD_STATE && !hasOwn(states, source)) {
      throw new Error(MESSAGES.transitionSourceMissing(source));
    }

    for (const eventType in eventMap) {
      if (!hasOwn(eventMap, eventType)) continue;

      const definitions = eventMap[eventType];
      if (!definitions) continue;

      for (const definition of definitions) {
        if (definition.target === WILDCARD_STATE) {
          throw new Error(MESSAGES.wildcardTarget);
        }

        if (!hasOwn(states, definition.target)) {
          throw new Error(MESSAGES.transitionTargetMissing(definition.target));
        }
      }
    }
  }
}
