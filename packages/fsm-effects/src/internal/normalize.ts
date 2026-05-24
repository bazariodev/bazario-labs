import type { FsmEvent } from '@bazariodev/fsm';

import type { Effect, EffectsConfig } from '../types.js';
import { hasOwn } from './predicates.js';

export type NormalizedEffectsMap<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<
  Partial<Record<TState | '*', ReadonlyArray<Effect<TState, TEvent, TContext>>>>
>;

export function normalizeEffects<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  effects: EffectsConfig<TState, TEvent, TContext>['effects'],
): NormalizedEffectsMap<TState, TEvent, TContext> {
  if (
    typeof effects !== 'object' ||
    effects === null ||
    Array.isArray(effects)
  ) {
    throw new Error('fsm-effects: effects must be an object');
  }

  const normalized: Partial<
    Record<TState | '*', ReadonlyArray<Effect<TState, TEvent, TContext>>>
  > = {};

  for (const key in effects) {
    if (!hasOwn(effects, key)) continue;

    const entry:
      | Effect<TState, TEvent, TContext>
      | ReadonlyArray<Effect<TState, TEvent, TContext>>
      | undefined = effects[key];
    if (entry === undefined) continue;

    if (typeof entry === 'function') {
      normalized[key] = Object.freeze([entry]);
      continue;
    }

    if (!Array.isArray(entry)) {
      throw new Error(
        `fsm-effects: effects["${String(key)}"] must be a function or array of functions`,
      );
    }

    const items = entry.slice();
    for (let i = 0; i < items.length; i++) {
      if (typeof items[i] !== 'function') {
        throw new Error(
          `fsm-effects: effects["${String(key)}"][${i}] must be a function`,
        );
      }
    }
    normalized[key] = Object.freeze(items);
  }

  return Object.freeze(normalized);
}
