import type { FsmEvent } from '@bazariodev/fsm';

import type { DelaySpec, Resolvable } from '../types.js';
import { isValidAfter, isValidEvery } from './duration.js';
import { MESSAGES } from './messages.js';
import { isObject } from './predicates.js';

export type NormalizedDelaySpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> = Readonly<{
  kind: 'after' | 'every';
  duration: Resolvable<number, TState, TContext>;
  send: Resolvable<TEvent, TState, TContext>;
  id?: string;
}>;

export function normalizeDelaySpec<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  spec: DelaySpec<TState, TEvent, TContext>,
  path: string,
): NormalizedDelaySpec<TState, TEvent, TContext> {
  if (!isObject(spec)) {
    throw new Error(MESSAGES.notDelaySpec(path));
  }

  const isAfter = 'after' in spec;
  const isEvery = 'every' in spec;
  if (isAfter === isEvery) {
    throw new Error(MESSAGES.oneOfAfterEvery(path));
  }
  if (spec.send === undefined) {
    throw new Error(MESSAGES.missingSend(path));
  }

  if (isAfter) {
    if (typeof spec.after === 'number' && !isValidAfter(spec.after)) {
      throw new Error(MESSAGES.invalidAfter(path));
    }
    return {
      kind: 'after',
      duration: spec.after,
      send: spec.send,
      id: spec.id,
    };
  }

  if (typeof spec.every === 'number' && !isValidEvery(spec.every)) {
    throw new Error(MESSAGES.invalidEvery(path));
  }
  return {
    kind: 'every',
    duration: spec.every,
    send: spec.send,
    id: spec.id,
  };
}
