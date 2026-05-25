import { describe, expect, it } from 'vitest';

import { FsmEffects } from '../fsm-effects.js';
import type { EffectsConfig } from '../types.js';
import {
  type Context,
  createMachine,
  type Event,
  type State,
} from './helpers.js';

describe('FsmEffects validation', () => {
  type Config = EffectsConfig<State, Event, Context>;

  const instantiate = (config: unknown): void => {
    new FsmEffects(createMachine('a'), config as Config);
  };

  it('throws when effects is not an object', () => {
    expect(() => instantiate({ effects: null })).toThrow(
      'fsm-effects: effects must be an object',
    );
  });

  it('throws when effects is an array', () => {
    expect(() => instantiate({ effects: [] })).toThrow(
      'fsm-effects: effects must be an object',
    );
  });

  it('throws when an entry is null', () => {
    expect(() => instantiate({ effects: { a: null } })).toThrow(
      /fsm-effects: effects\["a"\] must be a function or array of functions/,
    );
  });

  it('throws when an entry is a primitive', () => {
    expect(() => instantiate({ effects: { a: 42 } })).toThrow(
      /fsm-effects: effects\["a"\] must be a function or array of functions/,
    );
  });

  it('throws when an array contains a non-function entry', () => {
    expect(() =>
      instantiate({ effects: { a: [() => undefined, null] } }),
    ).toThrow(/fsm-effects: effects\["a"\]\[1\] must be a function/);
  });

  it('treats undefined entries as absent', () => {
    expect(() => instantiate({ effects: { a: undefined } })).not.toThrow();
  });
});

describe('FsmEffects config isolation', () => {
  it('captures the effects array contents at construction time', () => {
    const machine = createMachine('a');
    const log: string[] = [];
    const bEffects = [
      () => {
        log.push('original');
      },
    ];

    new FsmEffects(machine, { effects: { b: bEffects } });

    bEffects.push(() => {
      log.push('appended');
    });
    bEffects[0] = () => {
      log.push('replaced');
    };

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['original']);
  });

  it('ignores replacement of an entry on the effects map after construction', () => {
    const machine = createMachine('a');
    const log: string[] = [];
    const config: { effects: Record<string, () => void> } = {
      effects: {
        b: () => {
          log.push('original');
        },
      },
    };

    new FsmEffects(
      machine,
      config as unknown as EffectsConfig<State, Event, Context>,
    );

    config.effects.b = () => {
      log.push('replaced');
    };

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['original']);
  });
});
