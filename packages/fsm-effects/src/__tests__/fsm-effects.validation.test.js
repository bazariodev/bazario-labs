import { describe, expect, it } from 'vitest';

import { FsmEffects } from '../index.js';

import { createMachine } from './helpers.js';

describe('FsmEffects validation', () => {
  const instantiate = (config) => {
    new FsmEffects(createMachine('a'), config);
  };

  it('throws when effects is not a plain object', () => {
    const map = new Map([['a', () => undefined]]);
    for (const effects of [null, 42, [() => undefined], map, new Date()]) {
      expect(() => instantiate({ effects })).toThrow(
        'fsm-effects: effects must be a plain object',
      );
    }
  });

  it('throws when an entry is not a function or an array of functions', () => {
    for (const entry of [null, 42, [() => undefined, null]]) {
      expect(() => instantiate({ effects: { a: entry } })).toThrow(
        'fsm-effects: effects["a"] must be a function or an array of functions',
      );
    }
  });

  it('accepts null-prototype effect maps', () => {
    const effects = Object.assign(Object.create(null), { a: () => undefined });
    expect(() => instantiate({ effects })).not.toThrow();
  });

  it('treats undefined entries as absent', () => {
    expect(() => instantiate({ effects: { a: undefined } })).not.toThrow();
  });
});

describe('FsmEffects config isolation', () => {
  it('captures the effects array contents at construction time', () => {
    const machine = createMachine('a');
    const log = [];
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
    const log = [];
    const config = {
      effects: {
        b: () => {
          log.push('original');
        },
      },
    };

    new FsmEffects(machine, config);

    config.effects.b = () => {
      log.push('replaced');
    };

    machine.send({ type: 'GO_B' });

    expect(log).toEqual(['original']);
  });
});
