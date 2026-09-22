import {
  Fsm,
  type FsmConfig,
  type FsmCore,
  type FsmSnapshot,
  type FsmSubscribable,
  type Logger,
  type StateLeavePayload,
  type TransitionMap,
  type TransitionStartPayload,
  type Unsubscribe,
} from '../index.js';

type State = 'idle' | 'dialing' | 'connected';
type Event = { type: 'DIAL'; destination: string } | { type: 'HANGUP' };
type Context = { destination: string | null };

// Partial maps: states without transitions and '*' may be omitted.
const transitions: TransitionMap<State, Event, Context> = {
  idle: {
    DIAL: {
      target: 'dialing',
      guard: (_context, event) => event.type === 'DIAL',
      reducer: (context, event) =>
        event.type === 'DIAL' ? { destination: event.destination } : context,
    },
  },
  '*': { HANGUP: [{ target: 'idle' }] },
};

const config: FsmConfig<State, Event, Context> = {
  name: 'call',
  initial: 'idle',
  context: { destination: null },
  states: {
    idle: {},
    dialing: { onEnter: ({ from, event }) => void [from, event] },
    connected: { onLeave: ({ from, to }) => void [from, to] },
  },
  transitions,
  onTransitionStart: ({ from, to }) => void [from, to],
  onTransitionBeforeCommit: ({ previousContext, nextContext }) =>
    void [previousContext, nextContext],
  logger: { debug() {}, warn() {}, error() {} },
};

const machine = new Fsm(config);
const core: FsmCore<State, Event, Context> = machine;
const source: FsmSubscribable<FsmSnapshot<State, Context>> = machine;
const state: State = core.state;
const version: number = machine.snapshot.version;
const allowed: boolean = machine.can({ type: 'HANGUP' });
const result: void = machine.send({ type: 'DIAL', destination: '1001' });
const unsubscribe: Unsubscribe = machine.subscribe((snapshot) => {
  const value: State = snapshot.value;
  const previous: State | null = snapshot.previousValue;
  void [value, previous];
});
unsubscribe();
void [source, state, version, allowed, result];

const leave: StateLeavePayload<State, Event, Context> = {
  from: 'idle',
  to: 'dialing',
  event: { type: 'HANGUP' },
  context: { destination: null },
};
const start: TransitionStartPayload<State, Event, Context> = leave;
void start;

// @ts-expect-error Events must be members of the event union.
machine.send({ type: 'UNKNOWN' });
// @ts-expect-error Event payloads are checked.
machine.send({ type: 'DIAL' });
// @ts-expect-error Snapshots are read-only.
machine.snapshot.version = 1;

const badTarget: TransitionMap<State, Event, Context> = {
  // @ts-expect-error Targets must be declared states.
  idle: { DIAL: { target: 'missing' } },
};
void badTarget;

const missingState: FsmConfig<State, Event, Context> = {
  ...config,
  // @ts-expect-error Every state must be declared.
  states: { idle: {}, dialing: {} },
};
void missingState;

// @ts-expect-error All logger levels are required.
const partialLogger: Logger = { error() {} };
void partialLogger;
