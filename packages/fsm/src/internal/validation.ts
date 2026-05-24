import type {
  FsmConfig,
  FsmEvent,
  StateDefinition,
  TransitionDefinition,
  TransitionMap,
} from '../types.js';
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
    throw new Error(`fsm: transition definition "${path}" must be an object`);
  }

  if (!hasOwn(definition, 'target')) {
    throw new Error(`fsm: transition definition "${path}" must include target`);
  }

  if (typeof definition.target !== 'string') {
    throw new Error(
      `fsm: transition definition "${path}" target must be a string`,
    );
  }

  if (
    hasOwn(definition, 'guard') &&
    definition.guard !== undefined &&
    typeof definition.guard !== 'function'
  ) {
    throw new Error(
      `fsm: transition definition "${path}" guard must be a function`,
    );
  }

  if (
    hasOwn(definition, 'reducer') &&
    definition.reducer !== undefined &&
    typeof definition.reducer !== 'function'
  ) {
    throw new Error(
      `fsm: transition definition "${path}" reducer must be a function`,
    );
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
  if (!isRecord(states)) throw new Error('fsm: states must be an object');

  const normalized = {} as Record<
    TState,
    StateDefinition<TState, TEvent, TContext>
  >;

  for (const key in states) {
    if (!hasOwn(states, key)) continue;

    const definition = states[key];
    if (!isRecord(definition)) {
      throw new Error(`fsm: state definition "${key}" must be an object`);
    }

    const { onEnter, onLeave } = definition;

    if (onEnter !== undefined && typeof onEnter !== 'function') {
      throw new Error(
        `fsm: state definition "${key}" onEnter must be a function`,
      );
    }

    if (onLeave !== undefined && typeof onLeave !== 'function') {
      throw new Error(
        `fsm: state definition "${key}" onLeave must be a function`,
      );
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
  if (!isRecord(transitions))
    throw new Error('fsm: transitions must be an object');

  const normalized: NormalizedTransitionMap<TState, TEvent, TContext> = {};

  for (const source in transitions) {
    if (!hasOwn(transitions, source)) continue;

    const eventMap = transitions[source];
    if (!isRecord(eventMap)) {
      throw new Error(
        `fsm: transition source "${source}" must define an event map`,
      );
    }

    const bucket: TransitionBucket<TState, TEvent, TContext> = {};

    for (const eventType in eventMap) {
      if (!hasOwn(eventMap, eventType)) continue;

      const entry = eventMap[eventType];
      const definitions = Array.isArray(entry) ? [...entry] : [entry];

      if (definitions.length === 0) {
        throw new Error(
          `fsm: transition entry "${source}.${eventType}" must include at least one definition`,
        );
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
  if (!config.name.trim()) throw new Error('fsm: name must not be empty');

  if (hasOwn(states, WILDCARD_STATE)) {
    throw new Error('fsm: "*" is reserved and cannot be used as a state name');
  }

  if (!hasOwn(states, config.initial)) {
    throw new Error(
      `fsm: initial state "${config.initial}" must exist in states`,
    );
  }

  for (const source in transitions) {
    if (!hasOwn(transitions, source)) continue;

    const eventMap = transitions[source];
    if (eventMap === undefined) continue;

    if (source !== WILDCARD_STATE && !hasOwn(states, source)) {
      throw new Error(
        `fsm: transition source state "${source}" must exist in states`,
      );
    }

    for (const eventType in eventMap) {
      if (!hasOwn(eventMap, eventType)) continue;

      const definitions = eventMap[eventType];
      if (!definitions) continue;

      for (const definition of definitions) {
        if (definition.target === WILDCARD_STATE) {
          throw new Error('fsm: "*" cannot be used as a transition target');
        }

        if (!hasOwn(states, definition.target)) {
          throw new Error(
            `fsm: transition target "${definition.target}" must exist in states`,
          );
        }
      }
    }
  }
}
