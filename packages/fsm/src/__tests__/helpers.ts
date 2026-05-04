import { vi } from 'vitest';

import { Fsm } from '../fsm.js';
import type {
  FsmConfig,
  Logger,
  StateDefinition,
  TransitionMap,
} from '../types.js';

export type CallState = 'idle' | 'dialing' | 'connected' | 'failed';

export type CallEvent =
  | { type: 'DIAL'; destination: string }
  | { type: 'CONNECT' }
  | { type: 'RESET' }
  | { type: 'FAIL' };

export type CallContext = {
  attempts: number;
  destination: string | null;
  reason: string | null;
};

export const createContext = (): CallContext => ({
  attempts: 0,
  destination: null,
  reason: null,
});

export const createStates = (): Record<
  CallState,
  StateDefinition<CallState, CallEvent, CallContext>
> => ({
  idle: {},
  dialing: {},
  connected: {},
  failed: {},
});

export const createTransitions = (): TransitionMap<
  CallState,
  CallEvent,
  CallContext
> => ({
  idle: {},
  dialing: {},
  connected: {},
  failed: {},
  '*': {},
});

export const createConfig = (
  config: Partial<FsmConfig<CallState, CallEvent, CallContext>> = {},
): FsmConfig<CallState, CallEvent, CallContext> => ({
  name: config.name ?? 'call-flow',
  initial: config.initial ?? 'idle',
  context: config.context ?? createContext(),
  states: config.states ?? createStates(),
  transitions: config.transitions ?? createTransitions(),
  onTransitionStart: config.onTransitionStart,
  onTransitionBeforeCommit: config.onTransitionBeforeCommit,
  logger: config.logger,
});

export const createMachine = (
  config: Partial<FsmConfig<CallState, CallEvent, CallContext>> = {},
): Fsm<CallState, CallEvent, CallContext> =>
  new Fsm<CallState, CallEvent, CallContext>(createConfig(config));

export const createLogger = (): Logger => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});
