import type {
  FsmCore,
  FsmEvent,
  FsmSnapshot,
  Logger,
  Unsubscribe,
} from '@bazariodev/fsm';

import {
  type NormalizedEffectsMap,
  normalizeEffects,
} from './internal/normalize.js';
import { NOOP_LOGGER, WILDCARD } from './internal/predicates.js';
import type {
  Effect,
  EffectApi,
  EffectCleanup,
  EffectsConfig,
} from './types.js';

export class FsmEffects<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> {
  readonly #machine: FsmCore<TState, TEvent, TContext>;
  readonly #effects: NormalizedEffectsMap<TState, TEvent, TContext>;
  readonly #logger: Logger;
  readonly #unsubscribe: Unsubscribe;

  #controller: AbortController;
  #processedState: TState;
  #lastProcessedVersion: number;
  #pending: FsmSnapshot<TState, TContext> | null = null;
  #draining = false;
  #stopped = false;

  constructor(
    machine: FsmCore<TState, TEvent, TContext>,
    config: EffectsConfig<TState, TEvent, TContext>,
  ) {
    this.#machine = machine;
    this.#effects = normalizeEffects<TState, TEvent, TContext>(config.effects);
    this.#logger = config.logger ?? NOOP_LOGGER;

    const snapshot = machine.snapshot;
    this.#processedState = snapshot.value;
    this.#lastProcessedVersion = snapshot.version;
    this.#controller = new AbortController();

    this.#unsubscribe = machine.subscribe((next) => this.#onSnapshot(next));

    this.#spawnEffectsFor(snapshot);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#controller.abort();
    this.#unsubscribe();
  }

  [Symbol.dispose](): void {
    this.stop();
  }

  #onSnapshot(snapshot: FsmSnapshot<TState, TContext>): void {
    if (this.#stopped || snapshot.version <= this.#lastProcessedVersion) return;
    this.#lastProcessedVersion = snapshot.version;

    if (snapshot.value === this.#processedState) return;
    this.#processedState = snapshot.value;

    // Re-entrancy: a nested send() only queues the target; the active drain loop
    // owns all spawning. See README — "Re-entrancy: the drain loop".
    this.#pending = snapshot;
    if (this.#draining) return;

    this.#draining = true;
    try {
      while (!this.#stopped && this.#pending) {
        const next = this.#pending;
        this.#pending = null;

        const oldController = this.#controller;
        this.#controller = new AbortController();

        oldController.abort();

        if (this.#stopped) break;
        if (this.#pending) continue;

        this.#spawnEffectsFor(next);
      }
    } finally {
      this.#draining = false;
    }
  }

  #spawnEffectsFor(snapshot: FsmSnapshot<TState, TContext>): void {
    const { signal } = this.#controller;
    const api: EffectApi<TEvent> = Object.freeze({
      signal,
      send: (event: TEvent) => {
        if (!signal.aborted) this.#machine.send(event);
      },
    });

    const stateEffects = this.#effects[snapshot.value];
    const wildcardEffects = this.#effects[WILDCARD];

    if (stateEffects) {
      for (const effect of stateEffects) {
        if (signal.aborted || this.#pending) return;
        this.#runEffect(effect, snapshot, api);
      }
    }

    if (wildcardEffects) {
      for (const effect of wildcardEffects) {
        if (signal.aborted || this.#pending) return;
        this.#runEffect(effect, snapshot, api);
      }
    }
  }

  #runEffect(
    effect: Effect<TState, TEvent, TContext>,
    snapshot: FsmSnapshot<TState, TContext>,
    api: EffectApi<TEvent>,
  ): void {
    let result: ReturnType<Effect<TState, TEvent, TContext>>;
    try {
      result = effect(snapshot, api);
    } catch (error) {
      this.#logger.error('fsm-effects: effect threw', {
        state: snapshot.value,
        version: snapshot.version,
        error,
      });
      return;
    }

    if (!result) return;

    if (typeof result === 'function') {
      this.#registerCleanup(result, api.signal);
      return;
    }

    result.then(
      (cleanup) => {
        if (typeof cleanup === 'function') {
          this.#registerCleanup(cleanup, api.signal);
        }
      },
      (error) => {
        const meta = {
          state: snapshot.value,
          version: snapshot.version,
          error,
        };
        if (api.signal.aborted) {
          this.#logger.debug('fsm-effects: effect rejected after abort', meta);
        } else {
          this.#logger.error('fsm-effects: effect rejected', meta);
        }
      },
    );
  }

  #registerCleanup(cleanup: EffectCleanup, signal: AbortSignal): void {
    if (signal.aborted) {
      this.#invokeCleanup(cleanup);
      return;
    }

    signal.addEventListener('abort', () => this.#invokeCleanup(cleanup), {
      once: true,
    });
  }

  #invokeCleanup(cleanup: EffectCleanup): void {
    try {
      cleanup();
    } catch (error) {
      this.#logger.error('fsm-effects: cleanup threw', { error });
    }
  }
}
