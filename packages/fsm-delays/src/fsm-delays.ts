import type { FsmCore, FsmEvent } from '@bazariodev/fsm';
import { FsmEffects } from '@bazariodev/fsm-effects';

import { compileDelays } from './compile-delays.js';
import type { DelaysConfig } from './types.js';

export class FsmDelays<
  TState extends string,
  TEvent extends FsmEvent,
  TContext,
> {
  readonly #effects: FsmEffects<TState, TEvent, TContext>;

  constructor(
    machine: FsmCore<TState, TEvent, TContext>,
    config: DelaysConfig<TState, TEvent, TContext>,
  ) {
    this.#effects = new FsmEffects(machine, {
      effects: compileDelays(config),
      logger: config.logger,
    });
  }

  stop(): void {
    this.#effects.stop();
  }

  [Symbol.dispose](): void {
    this.stop();
  }
}
