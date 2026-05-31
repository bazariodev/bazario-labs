import type { FsmEvent, Logger } from '@bazariodev/fsm';
import type { Effect, EffectsConfig } from '@bazariodev/fsm-effects';

import {
  type NormalizedDelaySpec,
  normalizeDelaySpec,
} from './internal/delay-validation.js';
import { isValidAfter, isValidEvery } from './internal/duration.js';
import { MESSAGES } from './internal/messages.js';
import { hasOwn, isObject, NOOP_LOGGER } from './internal/predicates.js';
import { type DelayMeta, fireSend, resolve } from './internal/resolve.js';
import { DEFAULT_SCHEDULER } from './internal/scheduler.js';
import type { DelaysConfig, Scheduler } from './types.js';

export function compileDelays<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  config: DelaysConfig<TState, TEvent, TContext>,
): EffectsConfig<TState, TEvent, TContext>['effects'] {
  const { delays } = config;
  if (!isObject(delays)) {
    throw new Error(MESSAGES.delaysNotObject);
  }

  const scheduler = config.scheduler ?? DEFAULT_SCHEDULER;
  const logger = config.logger ?? NOOP_LOGGER;

  const compiled: Partial<
    Record<TState | '*', ReadonlyArray<Effect<TState, TEvent, TContext>>>
  > = {};

  for (const key in delays) {
    if (!hasOwn(delays, key) || !delays[key]) continue;

    const entry = delays[key];

    const state = String(key);
    const specs = Array.isArray(entry) ? entry : [entry];
    const effects = specs.map((spec, index) => {
      const normalized = normalizeDelaySpec<TState, TEvent, TContext>(
        spec,
        MESSAGES.path(state, index),
      );
      return createDelayEffect(normalized, scheduler, logger, {
        state,
        index,
        id: normalized.id,
      });
    });

    compiled[key] = Object.freeze(effects);
  }

  return Object.freeze(compiled);
}

function createDelayEffect<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
>(
  spec: NormalizedDelaySpec<TState, TEvent, TContext>,
  scheduler: Scheduler,
  logger: Logger,
  meta: DelayMeta,
): Effect<TState, TEvent, TContext> {
  const repeating = spec.kind === 'every';
  return (snapshot, api) => {
    const ms = resolve(spec.duration, snapshot);
    if (repeating ? !isValidEvery(ms) : !isValidAfter(ms)) {
      logger.warn(repeating ? MESSAGES.skippedEvery : MESSAGES.skippedAfter, {
        ...meta,
        [spec.kind]: ms,
      });
      return;
    }

    const run = (): void =>
      fireSend(spec.send, snapshot, api.send, logger, meta);
    if (repeating) {
      const handle = scheduler.setInterval(run, ms);
      return () => scheduler.clearInterval(handle);
    }
    const handle = scheduler.setTimeout(run, ms);
    return () => scheduler.clearTimeout(handle);
  };
}
