import { Fsm, type FsmConfig, type Logger } from '@bazariodev/fsm';
import { vi } from 'vitest';

export type State = 'a' | 'b' | 'c' | 'd';

export type Event =
  | { type: 'GO_B' }
  | { type: 'GO_C' }
  | { type: 'GO_D' }
  | { type: 'GO_A' }
  | { type: 'PING' }
  | { type: 'RESET' }
  | { type: 'NOOP' };

export type Context = { count: number };

export const createMachine = (
  initial: State = 'a',
  overrides: Partial<FsmConfig<State, Event, Context>> = {},
): Fsm<State, Event, Context> =>
  new Fsm<State, Event, Context>({
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

export const createLogger = (): Logger => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
};
