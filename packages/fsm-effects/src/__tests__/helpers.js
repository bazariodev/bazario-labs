import { Fsm } from '@bazariodev/fsm';
import { vi } from 'vitest';

export const createMachine = (initial = 'a', overrides = {}) =>
  new Fsm({
    name: 'effects-test',
    initial,
    context: { count: 0 },
    states: { a: {}, b: {}, c: {}, d: {} },
    transitions: {
      a: { GO_B: { target: 'b' } },
      b: {
        GO_C: { target: 'c' },
        GO_D: { target: 'd' },
        PING: { target: 'b' },
      },
      c: { GO_D: { target: 'd' } },
      d: { GO_A: { target: 'a' }, GO_B: { target: 'b' } },
      '*': { RESET: { target: 'a' } },
    },
    ...overrides,
  });

export const createLogger = () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
};
