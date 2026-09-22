import { Fsm } from '@bazariodev/fsm';
import {
  type Effect,
  type EffectApi,
  type EffectCleanup,
  type EffectsConfig,
  FsmEffects,
} from '../index.js';

type State = 'idle' | 'dialing';
type Event = { type: 'DIAL'; destination: string } | { type: 'HANGUP' };
type Context = { attempts: number };

const machine = new Fsm<State, Event, Context>({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0 },
  states: { idle: {}, dialing: {} },
  transitions: { idle: { DIAL: { target: 'dialing' } } },
});

const dial: Effect<State, Event, Context> = (snapshot, api) => {
  const state: State = snapshot.value;
  const attempts: number = snapshot.context.attempts;
  const signal: AbortSignal = api.signal;
  api.send({ type: 'HANGUP' });
  // @ts-expect-error Effects may only send machine events.
  api.send({ type: 'UNKNOWN' });
  void [state, attempts, signal];
  return () => undefined;
};

const load: Effect<State, Event, Context> = async ({ context }, { signal }) => {
  void [context, signal];
  const cleanup: EffectCleanup = () => undefined;
  return cleanup;
};

const config: EffectsConfig<State, Event, Context> = {
  effects: { dialing: [dial, load], '*': () => undefined },
  logger: { debug() {}, warn() {}, error() {} },
};

const effects = new FsmEffects(machine, config);
const stopped: void = effects.stop();
effects[Symbol.dispose]();
void stopped;

const api: EffectApi<Event> = {
  signal: new AbortController().signal,
  send() {},
};
void api;

new FsmEffects(machine, {
  // @ts-expect-error Keys must be declared states or '*'.
  effects: { missing: () => undefined },
});

new FsmEffects(machine, {
  // @ts-expect-error Effects must return nothing, a cleanup, or a promise of one.
  effects: { idle: () => 42 },
});
