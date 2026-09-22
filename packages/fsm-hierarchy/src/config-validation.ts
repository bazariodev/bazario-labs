import type { FsmEvent } from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import { hasOwn, isRecord, WILDCARD_STATE } from './internal/predicates.js';
import type { AnyHierarchyConfig } from './types.js';

export function childConfigFor<TEvent extends FsmEvent>(
  config: AnyHierarchyConfig<TEvent>,
  state: string,
): AnyHierarchyConfig<TEvent> | undefined {
  const children = config.children;
  return children && hasOwn(children, state) ? children[state] : undefined;
}

export function validateConfigTree<TEvent extends FsmEvent>(
  config: AnyHierarchyConfig<TEvent>,
): void {
  if (typeof config.name !== 'string' || !config.name.trim()) {
    throw new Error(MESSAGES.configNameNonEmpty);
  }

  if (typeof config.initial !== 'string') {
    throw new Error(MESSAGES.initialStateString);
  }

  if (!isRecord(config.states)) {
    throw new Error(MESSAGES.statesNotObject);
  }

  if (!isRecord(config.transitions)) {
    throw new Error(MESSAGES.transitionsNotObject);
  }

  const states = new Set(Object.keys(config.states));

  for (const state of states) {
    if (state === WILDCARD_STATE) {
      throw new Error(MESSAGES.wildcardReservedState);
    }

    if (state.includes('.')) {
      throw new Error(MESSAGES.stateNamesNoDot);
    }

    validateStateDefinition(state, config.states[state]);
  }

  if (!hasOwn(config.states, config.initial)) {
    throw new Error(MESSAGES.initialStateMissing);
  }

  const children = config.children;
  if (children !== undefined) {
    if (!isRecord(children)) {
      throw new Error(MESSAGES.childrenNotObject);
    }

    for (const childState of Object.keys(children)) {
      if (!states.has(childState)) {
        throw new Error(MESSAGES.childKeyMissing);
      }

      if (!isRecord(children[childState])) {
        throw new Error(MESSAGES.childConfigNotObject);
      }
    }
  }

  validateTransitions(config, states);

  for (const child of Object.values(children ?? {})) {
    if (child) validateConfigTree(child);
  }
}

function validateStateDefinition(state: string, definition: unknown): void {
  if (!isRecord(definition)) {
    throw new Error(MESSAGES.stateDefinitionsObject);
  }

  if (
    hasOwn(definition, 'onEnter') &&
    definition.onEnter !== undefined &&
    typeof definition.onEnter !== 'function'
  ) {
    throw new Error(MESSAGES.stateOnEnterNotFunction(state));
  }

  if (
    hasOwn(definition, 'onLeave') &&
    definition.onLeave !== undefined &&
    typeof definition.onLeave !== 'function'
  ) {
    throw new Error(MESSAGES.stateOnLeaveNotFunction(state));
  }
}

function validateTransitions<TEvent extends FsmEvent>(
  config: AnyHierarchyConfig<TEvent>,
  states: ReadonlySet<string>,
): void {
  for (const [source, eventMap] of Object.entries(config.transitions)) {
    if (source !== WILDCARD_STATE && !states.has(source)) {
      throw new Error(MESSAGES.transitionSourceMissing);
    }

    if (eventMap === undefined) continue;
    if (!isRecord(eventMap)) {
      throw new Error(MESSAGES.transitionSourceEventMap);
    }

    for (const entry of Object.values(eventMap)) {
      const definitions = Array.isArray(entry) ? entry : [entry];
      if (definitions.length === 0) {
        throw new Error(MESSAGES.transitionEntryEmpty);
      }
      for (const definition of definitions) {
        validateTransitionDefinition(definition, states);
      }
    }
  }
}

function validateTransitionDefinition(
  definition: unknown,
  states: ReadonlySet<string>,
): void {
  if (!isRecord(definition) || !hasOwn(definition, 'target')) {
    throw new Error(MESSAGES.transitionTargetMissing);
  }

  const target = definition.target;

  if (
    typeof target !== 'string' ||
    target === WILDCARD_STATE ||
    !states.has(target)
  ) {
    throw new Error(MESSAGES.transitionTargetMissing);
  }

  if (
    hasOwn(definition, 'guard') &&
    definition.guard !== undefined &&
    typeof definition.guard !== 'function'
  ) {
    throw new Error(MESSAGES.transitionGuardFunction);
  }

  if (
    hasOwn(definition, 'reducer') &&
    definition.reducer !== undefined &&
    typeof definition.reducer !== 'function'
  ) {
    throw new Error(MESSAGES.transitionReducerFunction);
  }
}
