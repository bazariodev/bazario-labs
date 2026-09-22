import { MESSAGES } from './messages.js';
import { WILDCARD_STATE } from './predicates.js';

/**
 * Copies the config into private maps (so later caller mutation has no effect)
 * and checks the graph invariants TypeScript cannot enforce.
 */
export function compileConfig(config) {
  if (!config.name.trim()) throw new Error(MESSAGES.nameEmpty);

  const states = new Map(
    Object.entries(config.states).map(([state, { onEnter, onLeave }]) => [
      state,
      { onEnter, onLeave },
    ]),
  );
  if (states.has(WILDCARD_STATE)) {
    throw new Error(MESSAGES.wildcardReservedState);
  }
  if (!states.has(config.initial)) {
    throw new Error(MESSAGES.initialStateMissing(config.initial));
  }

  const transitions = new Map();

  for (const [source, events] of Object.entries(config.transitions)) {
    if (source !== WILDCARD_STATE && !states.has(source)) {
      throw new Error(MESSAGES.transitionSourceMissing(source));
    }

    const bySource = new Map();
    for (const [eventType, entry] of Object.entries(events ?? {})) {
      const definitions = Array.isArray(entry) ? entry : [entry];
      if (definitions.length === 0) {
        throw new Error(MESSAGES.transitionEntryEmpty(source, eventType));
      }
      for (const { target } of definitions) {
        if (!states.has(target)) {
          throw new Error(MESSAGES.transitionTargetMissing(target));
        }
      }
      bySource.set(
        eventType,
        definitions.map(({ target, guard, reducer }) => ({
          target,
          guard,
          reducer,
        })),
      );
    }
    transitions.set(source, bySource);
  }

  return { states, transitions };
}
