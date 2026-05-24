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
  #currentEffectState: TState;
  #lastProcessedVersion: number;
  #stopped = false;

  constructor(
    machine: FsmCore<TState, TEvent, TContext>,
    config: EffectsConfig<TState, TEvent, TContext>,
  ) {
    this.#machine = machine;
    this.#effects = normalizeEffects<TState, TEvent, TContext>(config.effects);
    this.#logger = config.logger ?? NOOP_LOGGER;

    const snapshot = machine.snapshot;
    this.#currentEffectState = snapshot.value;
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
    if (this.#stopped) return;
    if (snapshot.version <= this.#lastProcessedVersion) return;
    this.#lastProcessedVersion = snapshot.version;

    if (snapshot.value === this.#currentEffectState) return;

    const oldController = this.#controller;
    const newController = new AbortController();
    this.#controller = newController;
    this.#currentEffectState = snapshot.value;

    oldController.abort();

    if (this.#stopped || this.#controller !== newController) return;

    this.#spawnEffectsFor(snapshot);
  }

  #spawnEffectsFor(snapshot: FsmSnapshot<TState, TContext>): void {
    const controller = this.#controller;
    const stateEffects = this.#effects[snapshot.value];
    const wildcardEffects = this.#effects[WILDCARD];

    if (stateEffects) {
      for (const effect of stateEffects) {
        if (controller.signal.aborted) return;
        this.#runEffect(effect, snapshot, controller);
      }
    }

    if (wildcardEffects) {
      for (const effect of wildcardEffects) {
        if (controller.signal.aborted) return;
        this.#runEffect(effect, snapshot, controller);
      }
    }
  }

  #runEffect(
    effect: Effect<TState, TEvent, TContext>,
    snapshot: FsmSnapshot<TState, TContext>,
    controller: AbortController,
  ): void {
    const api: EffectApi<TEvent> = Object.freeze({
      signal: controller.signal,
      send: (event: TEvent) => {
        if (controller.signal.aborted) return;
        this.#machine.send(event);
      },
    });

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

    if (result === undefined) return;

    if (typeof result === 'function') {
      this.#registerCleanup(result, controller);
      return;
    }

    result.then(
      (cleanup) => {
        if (typeof cleanup === 'function') {
          this.#registerCleanup(cleanup, controller);
        }
      },
      (error) => {
        const meta = {
          state: snapshot.value,
          version: snapshot.version,
          error,
        };
        if (controller.signal.aborted) {
          this.#logger.debug('fsm-effects: effect rejected after abort', meta);
        } else {
          this.#logger.error('fsm-effects: effect rejected', meta);
        }
      },
    );
  }

  #registerCleanup(cleanup: EffectCleanup, controller: AbortController): void {
    if (controller.signal.aborted) {
      this.#invokeCleanup(cleanup);
      return;
    }

    controller.signal.addEventListener(
      'abort',
      () => this.#invokeCleanup(cleanup),
      { once: true },
    );
  }

  #invokeCleanup(cleanup: EffectCleanup): void {
    try {
      cleanup();
    } catch (error) {
      this.#logger.error('fsm-effects: cleanup threw', { error });
    }
  }
}
