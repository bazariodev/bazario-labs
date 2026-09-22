import { vi } from 'vitest';

import { Fsm } from '../index.js';

export const createContext = () => ({
  attempts: 0,
  destination: null,
  reason: null,
});

export const createStates = () => ({
  idle: {},
  dialing: {},
  connected: {},
  failed: {},
});

export const createTransitions = () => ({
  idle: {},
  dialing: {},
  connected: {},
  failed: {},
  '*': {},
});

export const createConfig = (config = {}) => ({
  name: config.name ?? 'call-flow',
  initial: config.initial ?? 'idle',
  context: config.context ?? createContext(),
  states: config.states ?? createStates(),
  transitions: config.transitions ?? createTransitions(),
  onTransitionStart: config.onTransitionStart,
  onTransitionBeforeCommit: config.onTransitionBeforeCommit,
  logger: config.logger,
});

export const createMachine = (config = {}) => new Fsm(createConfig(config));

export const createLogger = () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});
