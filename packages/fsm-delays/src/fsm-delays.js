import { FsmEffects } from '@bazariodev/fsm-effects';

import { MESSAGES } from './internal/messages.js';

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

// Wrappers keep browser timers from being called with the scheduler as `this`.
const DEFAULT_SCHEDULER = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle),
};

export class FsmDelays {
  #effects;

  constructor(machine, config) {
    this.#effects = new FsmEffects(machine, {
      effects: compileDelays(config),
      logger: config.logger,
    });
  }

  stop() {
    this.#effects.stop();
  }

  [Symbol.dispose]() {
    this.stop();
  }
}

export function compileDelays(config) {
  const { delays } = config;
  if (!isPlainObject(delays)) throw new Error(MESSAGES.delaysNotObject);
  const scheduler = config.scheduler ?? DEFAULT_SCHEDULER;
  const logger = config.logger ?? NOOP_LOGGER;

  // Null prototype so a state named `__proto__` is an ordinary own key.
  const effects = Object.create(null);
  for (const [state, entry] of Object.entries(delays)) {
    if (entry === undefined) continue;
    const specs = Array.isArray(entry) ? entry : [entry];
    effects[state] = specs.map((spec, index) =>
      createDelayEffect(
        compileSpec(spec, MESSAGES.path(state, index)),
        scheduler,
        logger,
        { state, index, id: spec.id },
      ),
    );
  }
  return effects;
}

// Delay failures happen inside timers and are only logged, so every shape
// problem that would silently disable a delay is rejected up front.
function compileSpec(spec, path) {
  if (!isPlainObject(spec)) throw new Error(MESSAGES.notDelaySpec(path));
  const hasAfter = 'after' in spec;
  const hasEvery = 'every' in spec;
  if (hasAfter === hasEvery) {
    throw new Error(MESSAGES.oneOfAfterEvery(path));
  }
  if (spec.send === undefined) throw new Error(MESSAGES.missingSend(path));

  const kind = hasAfter ? 'after' : 'every';
  const duration = spec[kind];
  // Only a resolver may produce its value later; anything else must already be valid.
  if (typeof duration !== 'function' && !isValidDuration(kind, duration)) {
    throw new Error(MESSAGES.invalidDuration(path, kind));
  }
  return { kind, duration, send: spec.send };
}

function createDelayEffect({ kind, duration, send }, scheduler, logger, meta) {
  return (snapshot, api) => {
    const ms = resolve(duration, snapshot);
    if (!isValidDuration(kind, ms)) {
      logger.warn(MESSAGES.skipped[kind], { ...meta, [kind]: ms });
      return;
    }

    // Timer callbacks run outside the effects runner's try/catch, so contain a
    // throw from resolving `send` or from the machine (guard, reducer, hook).
    const fire = () => {
      try {
        api.send(resolve(send, snapshot));
      } catch (error) {
        logger.error(MESSAGES.delayedSendThrew, { ...meta, error });
      }
    };

    if (kind === 'every') {
      const handle = scheduler.setInterval(fire, ms);
      return () => scheduler.clearInterval(handle);
    }
    const handle = scheduler.setTimeout(fire, ms);
    return () => scheduler.clearTimeout(handle);
  };
}

const resolve = (value, snapshot) =>
  typeof value === 'function' ? value(snapshot) : value;

const isValidDuration = (kind, ms) =>
  Number.isFinite(ms) && (kind === 'after' ? ms >= 0 : ms > 0);

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
