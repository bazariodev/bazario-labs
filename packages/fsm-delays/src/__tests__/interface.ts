import { Fsm } from '@bazariodev/fsm';
import { FsmEffects } from '@bazariodev/fsm-effects';
import {
  type AfterSpec,
  compileDelays,
  type DelaysConfig,
  type EverySpec,
  FsmDelays,
  type Scheduler,
} from '../index.js';

type State = 'ringing' | 'connected' | 'failed';
type Event = { type: 'NO_ANSWER' } | { type: 'PING'; seq: number };
type Context = { retries: number };

const machine = new Fsm<State, Event, Context>({
  name: 'call',
  initial: 'ringing',
  context: { retries: 0 },
  states: { ringing: {}, connected: {}, failed: {} },
  transitions: {
    ringing: { NO_ANSWER: { target: 'failed' } },
    connected: { PING: { target: 'connected' } },
  },
});

const timeout: AfterSpec<State, Event, Context> = {
  after: ({ context }) => 1_000 * 2 ** context.retries,
  send: { type: 'NO_ANSWER' },
  id: 'ring-timeout',
};
const ping: EverySpec<State, Event, Context> = {
  every: 5_000,
  send: ({ version }) => ({ type: 'PING', seq: version }),
};

const scheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as number),
};

const config: DelaysConfig<State, Event, Context> = {
  delays: { ringing: timeout, connected: [ping] },
  scheduler,
  logger: { debug() {}, warn() {}, error() {} },
};

const delays = new FsmDelays(machine, config);
const stopped: void = delays.stop();
delays[Symbol.dispose]();
void stopped;

// compileDelays output composes with other effects in one runner.
new FsmEffects(machine, {
  effects: { ...compileDelays(config), failed: () => undefined },
});

new FsmDelays(machine, {
  // @ts-expect-error Keys must be declared states or '*'.
  delays: { missing: timeout },
});

new FsmDelays(machine, {
  // @ts-expect-error Delays may only send machine events.
  delays: { ringing: { after: 1, send: { type: 'UNKNOWN' } } },
});

new FsmDelays(machine, {
  // @ts-expect-error A spec has exactly one of after or every.
  delays: { ringing: { after: 1, every: 1, send: { type: 'NO_ANSWER' } } },
});

new FsmDelays(machine, {
  // @ts-expect-error Durations must be numbers.
  delays: { ringing: { after: '1s', send: { type: 'NO_ANSWER' } } },
});
