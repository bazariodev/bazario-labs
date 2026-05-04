import type {
  FsmConfig,
  FsmEvent,
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

  return definition as TransitionDefinition<TState, TEvent, TContext>;
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
  transitions: NormalizedTransitionMap<TState, TEvent, TContext>,
): void {
  if (!config.name.trim()) throw new Error('fsm: name must not be empty');

  if (!(config.initial in config.states)) {
    throw new Error(
      `fsm: initial state "${config.initial}" must exist in states`,
    );
  }

  if (WILDCARD_STATE in config.states) {
    throw new Error('fsm: "*" is reserved and cannot be used as a state name');
  }

  for (const source in transitions) {
    if (!hasOwn(transitions, source)) continue;

    const eventMap = transitions[source];
    if (eventMap === undefined) continue;

    if (source !== WILDCARD_STATE && !(source in config.states)) {
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

        if (!(definition.target in config.states)) {
          throw new Error(
            `fsm: transition target "${definition.target}" must exist in states`,
          );
        }
      }
    }
  }
}
