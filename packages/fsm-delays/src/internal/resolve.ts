import type { FsmEvent, FsmSnapshot, Logger } from '@bazariodev/fsm';

import type { Resolvable } from '../types.js';
import { MESSAGES } from './messages.js';

export type DelayMeta = Readonly<{
  state: string;
  index: number;
  id: string | undefined;
}>;

export function resolve<T, TState extends string, TContext>(
  value: Resolvable<T, TState, TContext>,
  snapshot: FsmSnapshot<TState, TContext>,
): T {
  return typeof value === 'function'
    ? (value as (snapshot: FsmSnapshot<TState, TContext>) => T)(snapshot)
    : value;
}

// The timer callback runs after the effect body has returned, so it is outside
// the effects runner's try/catch. Contain it here: a throw from resolving `send`
// or from the dispatched `api.send` (a guard/reducer/hook error) is logged rather
// than escaping as an uncaught timer exception.
export function fireSend<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  send: Resolvable<TEvent, TState, TContext>,
  snapshot: FsmSnapshot<TState, TContext>,
  dispatch: (event: TEvent) => void,
  logger: Logger,
  meta: DelayMeta,
): void {
  try {
    dispatch(resolve(send, snapshot));
  } catch (error) {
    logger.error(MESSAGES.delayedSendThrew, { ...meta, error });
  }
}
