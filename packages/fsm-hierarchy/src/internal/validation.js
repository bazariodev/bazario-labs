import { MESSAGES } from './messages.js';

const WILDCARD = '*';

export function childConfigFor(config, state) {
  const { children } = config;
  return children && Object.hasOwn(children, state)
    ? children[state]
    : undefined;
}

/**
 * Checks the whole tree up front. Core validates a node only when it is spawned,
 * and a spawn failure stops the whole hierarchy, so anything that would break a
 * later spawn — or silently disable a child or transition — is rejected here.
 * Guards and reducers are left to TypeScript: a bad one throws from the send
 * that uses it without stopping the tree.
 */
export function validateConfigTree(config) {
  if (!config.name?.trim()) throw new Error(MESSAGES.configNameNonEmpty);
  requirePlainObject(config.states, MESSAGES.statesNotObject);
  requirePlainObject(config.transitions, MESSAGES.transitionsNotObject);
  if (config.children !== undefined) {
    requirePlainObject(config.children, MESSAGES.childrenNotObject);
  }

  const states = new Set(Object.keys(config.states));
  for (const state of states) {
    if (state === WILDCARD) throw new Error(MESSAGES.wildcardReservedState);
    // Each state is one path segment: "." would split it and "" would vanish from it.
    if (state === '') throw new Error(MESSAGES.stateNameEmpty);
    if (state.includes('.')) throw new Error(MESSAGES.stateNamesNoDot);
    validateStateDefinition(state, config.states[state]);
  }
  // Object.hasOwn would coerce a numeric initial to a string key, which core's
  // Map lookup then rejects at spawn.
  if (typeof config.initial !== 'string') {
    throw new Error(MESSAGES.initialStateString);
  }
  if (!Object.hasOwn(config.states, config.initial)) {
    throw new Error(MESSAGES.initialStateMissing);
  }

  const children = Object.entries(config.children ?? {});
  for (const [state, child] of children) {
    if (!states.has(state)) throw new Error(MESSAGES.childKeyMissing);
    if (child !== undefined) {
      requirePlainObject(child, MESSAGES.childConfigNotObject);
    }
  }

  for (const [source, events] of Object.entries(config.transitions)) {
    if (source !== WILDCARD && !states.has(source)) {
      throw new Error(MESSAGES.transitionSourceMissing);
    }
    if (events === undefined) continue;
    requirePlainObject(events, MESSAGES.transitionSourceEventMap);
    for (const entry of Object.values(events)) {
      const definitions = Array.isArray(entry) ? entry : [entry];
      if (definitions.length === 0) {
        throw new Error(MESSAGES.transitionEntryEmpty);
      }
      for (const definition of definitions) {
        if (!states.has(definition?.target)) {
          throw new Error(MESSAGES.transitionTargetMissing);
        }
      }
    }
  }

  for (const [, child] of children) {
    if (child) validateConfigTree(child);
  }
}

// A bad state definition or hook fails when its node is spawned, which is fatal.
function validateStateDefinition(state, definition) {
  requirePlainObject(definition, MESSAGES.stateDefinitionsObject);
  for (const hook of ['onEnter', 'onLeave']) {
    const value = definition[hook];
    if (value !== undefined && typeof value !== 'function') {
      throw new Error(MESSAGES.stateHookNotFunction(state, hook));
    }
  }
}

// Object.entries() accepts arrays, Maps, Dates, and other class instances without
// error, and each would silently disable the states, children, or transitions it holds.
function requirePlainObject(value, message) {
  const prototype =
    typeof value === 'object' && value !== null
      ? Object.getPrototypeOf(value)
      : undefined;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(message);
  }
}
