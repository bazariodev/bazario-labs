import { Fsm } from '@bazariodev/fsm';
import { FsmHierarchy } from '@bazariodev/fsm-hierarchy';
import { describe, expect, it } from 'vitest';

import {
  InspectRecorder,
  instrumentFsmConfig,
  mermaidFromFsmConfig,
  mermaidFromHierarchyConfig,
  recordSource,
} from '../index.js';
import { MESSAGES } from '../internal/messages.js';

const createCallConfig = (overrides = {}) => ({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0, destination: null, token: 'secret' },
  states: { idle: {}, dialing: {}, connected: {}, ended: {} },
  transitions: {
    idle: {
      DIAL: {
        target: 'dialing',
        reducer: (context, event) => ({
          ...context,
          attempts: context.attempts + 1,
          destination:
            event.type === 'DIAL' ? event.destination : context.destination,
        }),
      },
    },
    dialing: {
      CONNECT: { target: 'connected' },
      SELF: { target: 'dialing' },
    },
    connected: {
      HANGUP: { target: 'ended' },
    },
    ended: {},
    '*': {},
  },
  ...overrides,
});

const createRootConfig = () => ({
  name: 'root',
  initial: 'idle',
  context: { calls: 0 },
  states: { idle: {}, active: {} },
  transitions: {
    idle: { CONNECT: { target: 'active' } },
    active: {},
    '*': {},
  },
  children: {
    active: {
      name: 'child',
      initial: 'active',
      context: { pings: 0 },
      states: { active: {}, muted: {} },
      transitions: {
        active: { MUTE: { target: 'muted' } },
        muted: { UNMUTE: { target: 'active' } },
        '*': {},
      },
    },
  },
});

const pairEntries = (recorder) =>
  recorder.entries.filter(
    (entry) => entry.type === 'transition-start' || entry.type === 'transition',
  );

const failureOf = (run) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
};

describe('InspectRecorder', () => {
  it('keeps a bounded frozen ring buffer with cached defensive reads', () => {
    const recorder = new InspectRecorder({ limit: 2 });

    recorder.record({ type: 'log', at: 1, level: 'debug', message: 'a' });
    recorder.record({ type: 'log', at: 2, level: 'warn', message: 'b' });

    const read = recorder.entries;
    expect(Object.isFrozen(read)).toBe(true);
    expect(recorder.entries).toBe(read);
    expect(() => {
      read.push({});
    }).toThrow();

    recorder.record({ type: 'log', at: 3, level: 'error', message: 'c' });

    expect(recorder.entries).not.toBe(read);
    expect(recorder.entries.map((entry) => entry.at)).toEqual([2, 3]);

    recorder.clear();
    expect(recorder.entries).toEqual([]);
  });

  it('stores shallow-frozen copies and calls onEntry after buffering', () => {
    const seen = [];
    const recorder = new InspectRecorder({
      onEntry: (entry) => {
        seen.push(entry);
        expect(recorder.entries).toContain(entry);
      },
    });
    const entry = {
      type: 'log',
      at: 1,
      level: 'debug',
      message: 'before',
      meta: { nested: true },
    };

    recorder.record(entry);
    entry.message = 'after';

    expect(recorder.entries[0]).toMatchObject({ message: 'before' });
    expect(recorder.entries[0].meta).toBe(entry.meta);
    expect(Object.isFrozen(recorder.entries[0])).toBe(true);
    expect(seen).toEqual([recorder.entries[0]]);
  });

  it('maps logger metadata and drops logger entries when now or mapMeta throws', () => {
    const recorder = new InspectRecorder({
      mapMeta: (meta) => ({ redacted: meta !== undefined }),
      now: () => 7,
    });

    recorder.logger.error('failed', { token: 'secret' });

    expect(recorder.entries).toEqual([
      {
        type: 'log',
        at: 7,
        level: 'error',
        message: 'failed',
        meta: { redacted: true },
      },
    ]);

    const brokenNow = new InspectRecorder({
      now: () => {
        throw new Error('now');
      },
    });
    brokenNow.logger.warn('dropped');
    expect(brokenNow.entries).toEqual([]);

    const brokenMeta = new InspectRecorder({
      mapMeta: () => {
        throw new Error('meta');
      },
    });
    brokenMeta.logger.debug('dropped', {});
    expect(brokenMeta.entries).toEqual([]);
  });

  it('validates constructor options', () => {
    expect(() => new InspectRecorder({ limit: 0 })).toThrow(
      MESSAGES.invalidLimit,
    );
    expect(() => new InspectRecorder({ limit: 1.5 })).toThrow(
      MESSAGES.invalidLimit,
    );
    expect(() => new InspectRecorder({ mapEvent: true })).toThrow(
      MESSAGES.notAFunction('mapEvent'),
    );
    // A common slip: passing Date.now() instead of Date.now.
    expect(() => new InspectRecorder({ now: Date.now() })).toThrow(
      MESSAGES.notAFunction('now'),
    );
  });
});

describe('instrumentFsmConfig', () => {
  it('records init and transition start/complete entries with redacted context and event', () => {
    const ticks = [1, 2, 3];
    const recorder = new InspectRecorder({
      now: () => ticks.shift() ?? 99,
      mapContext: (context) =>
        typeof context === 'object' && context !== null
          ? { ...context, token: '<redacted>' }
          : context,
      mapEvent: (event) =>
        typeof event === 'object' && event !== null
          ? { ...event, token: '<redacted>' }
          : event,
    });
    const machine = new Fsm(instrumentFsmConfig(createCallConfig(), recorder));

    machine.send({ type: 'DIAL', destination: '101', token: 'event-secret' });

    expect(recorder.entries).toMatchObject([
      {
        type: 'init',
        at: 1,
        name: 'call',
        state: 'idle',
        context: { token: '<redacted>' },
      },
      {
        type: 'transition-start',
        at: 2,
        name: 'call',
        attemptId: 1,
        from: 'idle',
        to: 'dialing',
        eventType: 'DIAL',
        event: { token: '<redacted>' },
        contextBefore: { token: '<redacted>' },
      },
      {
        type: 'transition',
        at: 3,
        name: 'call',
        attemptId: 1,
        from: 'idle',
        to: 'dialing',
        eventType: 'DIAL',
        event: { token: '<redacted>' },
        contextAfter: { attempts: 1, destination: '101', token: '<redacted>' },
      },
    ]);
  });

  it('chains consumer hooks after recorder hooks and leaves abort attempts visible', () => {
    const calls = [];
    const recorder = new InspectRecorder({
      now: () => 1,
      onEntry: (entry) => calls.push(entry.type),
    });
    const config = createCallConfig({
      onTransitionStart: () => calls.push('consumer-start'),
      onTransitionBeforeCommit: () => calls.push('consumer-commit'),
      states: {
        ...createCallConfig().states,
        connected: {
          onEnter: () => {
            throw new Error('enter failed');
          },
        },
      },
    });
    const machine = new Fsm(instrumentFsmConfig(config, recorder));

    machine.send({ type: 'DIAL', destination: '101' });
    expect(() => machine.send({ type: 'CONNECT' })).toThrow('enter failed');

    expect(calls).toEqual([
      'init',
      'transition-start',
      'consumer-start',
      'transition',
      'consumer-commit',
      'transition-start',
      'consumer-start',
    ]);
    expect(pairEntries(recorder).map((entry) => entry.attemptId)).toEqual([
      1, 1, 2,
    ]);
  });

  it('shares recorder-allocated attempt ids across machines with the same name', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const first = new Fsm(instrumentFsmConfig(createCallConfig(), recorder));
    const second = new Fsm(instrumentFsmConfig(createCallConfig(), recorder));

    first.send({ type: 'DIAL', destination: '101' });
    second.send({ type: 'DIAL', destination: '102' });

    const starts = recorder.entries.filter(
      (entry) => entry.type === 'transition-start',
    );
    expect(starts.map((entry) => entry.attemptId)).toEqual([1, 2]);
  });

  it('keeps pairs intact when two machines share one instrumented config and one sends the other synchronously', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    let second = null;
    let sentNested = false;
    const config = createCallConfig({
      onTransitionStart: () => {
        if (sentNested || !second) return;
        sentNested = true;
        second.send({ type: 'DIAL', destination: '102' });
      },
    });
    const instrumented = instrumentFsmConfig(config, recorder);
    const first = new Fsm(instrumented);
    second = new Fsm(instrumented);

    first.send({ type: 'DIAL', destination: '101' });

    expect(
      pairEntries(recorder).map((entry) => ({
        type: entry.type,
        attemptId: entry.attemptId,
        event: entry.event,
      })),
    ).toEqual([
      {
        type: 'transition-start',
        attemptId: 1,
        event: { type: 'DIAL', destination: '101' },
      },
      {
        type: 'transition-start',
        attemptId: 2,
        event: { type: 'DIAL', destination: '102' },
      },
      {
        type: 'transition',
        attemptId: 2,
        event: { type: 'DIAL', destination: '102' },
      },
      {
        type: 'transition',
        attemptId: 1,
        event: { type: 'DIAL', destination: '101' },
      },
    ]);
  });

  it('pairs the outer attempt when a nested attempt from the same config aborts and is caught', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    let second = null;
    const base = createCallConfig();
    const config = createCallConfig({
      onTransitionStart() {
        if (this === second) return;
        try {
          second.send({ type: 'DIAL', destination: '102' });
        } catch {
          // The outer attempt carries on.
        }
      },
      states: {
        ...base.states,
        dialing: {
          onEnter: ({ event }) => {
            if (event.destination === '102') throw new Error('abort');
          },
        },
      },
    });
    const instrumented = instrumentFsmConfig(config, recorder);
    const first = new Fsm(instrumented);
    second = new Fsm(instrumented);

    first.send({ type: 'DIAL', destination: '101' });

    expect(first.state).toBe('dialing');
    expect(second.state).toBe('idle');
    expect(
      pairEntries(recorder).map((entry) => [entry.type, entry.attemptId]),
    ).toEqual([
      ['transition-start', 1],
      ['transition-start', 2],
      ['transition', 1],
    ]);
  });

  it('keeps later attempts paired after attempts abort in any hook', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    let failingHook = null;
    const failIf = (hook) => {
      if (hook === failingHook) throw new Error(hook);
    };
    const base = createCallConfig();
    const config = createCallConfig({
      onTransitionStart: () => failIf('onTransitionStart'),
      states: {
        ...base.states,
        idle: { onLeave: () => failIf('onLeave') },
        dialing: { onEnter: () => failIf('onEnter') },
      },
      transitions: {
        ...base.transitions,
        idle: {
          DIAL: {
            target: 'dialing',
            reducer: (context) => {
              failIf('reducer');
              return context;
            },
          },
        },
      },
    });
    const machine = new Fsm(instrumentFsmConfig(config, recorder));

    for (const hook of ['onTransitionStart', 'onLeave', 'reducer', 'onEnter']) {
      failingHook = hook;
      expect(() => machine.send({ type: 'DIAL', destination: '101' })).toThrow(
        hook,
      );
    }
    failingHook = null;
    machine.send({ type: 'DIAL', destination: '101' });

    expect(
      pairEntries(recorder).map((entry) => [entry.type, entry.attemptId]),
    ).toEqual([
      ['transition-start', 1],
      ['transition-start', 2],
      ['transition-start', 3],
      ['transition-start', 4],
      ['transition-start', 5],
      ['transition', 5],
    ]);
  });

  it('calls consumer transition hooks with the machine as the core does', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const receivers = [];
    const config = createCallConfig({
      onTransitionStart() {
        receivers.push(this);
      },
      onTransitionBeforeCommit() {
        receivers.push(this);
      },
    });
    const plain = new Fsm(config);
    const instrumented = new Fsm(instrumentFsmConfig(config, recorder));

    plain.send({ type: 'DIAL', destination: '101' });
    instrumented.send({ type: 'DIAL', destination: '101' });

    const names = receivers.map((receiver) =>
      receiver === plain
        ? 'plain'
        : receiver === instrumented && 'instrumented',
    );
    expect(names).toEqual(['plain', 'plain', 'instrumented', 'instrumented']);
  });

  it('keeps beforeCommit aborts as a start/complete pair and records self-transitions', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const config = createCallConfig({
      onTransitionBeforeCommit: (payload) => {
        if (payload.event.type === 'SELF') throw new Error('before failed');
      },
    });
    const machine = new Fsm(instrumentFsmConfig(config, recorder));

    machine.send({ type: 'DIAL', destination: '101' });
    expect(() => machine.send({ type: 'SELF' })).toThrow('before failed');

    expect(
      pairEntries(recorder).map((entry) => ({
        type: entry.type,
        attemptId: entry.attemptId,
        from: entry.from,
        to: entry.to,
      })),
    ).toEqual([
      { type: 'transition-start', attemptId: 1, from: 'idle', to: 'dialing' },
      { type: 'transition', attemptId: 1, from: 'idle', to: 'dialing' },
      {
        type: 'transition-start',
        attemptId: 2,
        from: 'dialing',
        to: 'dialing',
      },
      { type: 'transition', attemptId: 2, from: 'dialing', to: 'dialing' },
    ]);
  });

  it('records init for the state the machine starts in, even if initial changes after instrumentation', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const instrumented = instrumentFsmConfig(createCallConfig(), recorder);

    // As restoreFsmConfig from fsm-persist does: same hooks, new initial and context.
    new Fsm({
      ...instrumented,
      initial: 'connected',
      context: { attempts: 3 },
    });

    expect(recorder.entries).toEqual([
      {
        type: 'init',
        at: 1,
        name: 'call',
        state: 'connected',
        context: { attempts: 3 },
      },
    ]);
  });

  it('never mutates the input config', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const onTransitionStart = () => undefined;
    const onEnter = () => undefined;
    const config = createCallConfig({
      onTransitionStart,
      states: { ...createCallConfig().states, dialing: { onEnter } },
    });
    const { reducer } = config.transitions.idle.DIAL;

    const instrumented = instrumentFsmConfig(config, recorder);
    new Fsm(instrumented).send({ type: 'DIAL', destination: '101' });

    expect(instrumented).not.toBe(config);
    expect(config.onTransitionStart).toBe(onTransitionStart);
    expect(config.onTransitionBeforeCommit).toBeUndefined();
    expect(config.states.dialing).toEqual({ onEnter });
    expect(config.states.idle).toEqual({});
    expect(config.transitions.idle.DIAL.reducer).toBe(reducer);
    expect(instrumented.transitions).toBe(config.transitions);
  });

  it('keeps inherited state hooks, as the core reads them', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const calls = [];
    class IdleState {
      onLeave() {
        calls.push('leave');
      }
    }
    const config = createCallConfig({
      states: { ...createCallConfig().states, idle: new IdleState() },
    });

    new Fsm(instrumentFsmConfig(config, recorder)).send({
      type: 'DIAL',
      destination: '101',
    });

    expect(calls).toEqual(['leave']);
  });

  it('keeps a state named __proto__', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const config = JSON.parse(
      '{"name":"proto","initial":"idle","context":{},' +
        '"states":{"idle":{},"__proto__":{}},' +
        '"transitions":{"idle":{"GO":{"target":"__proto__"}},' +
        '"__proto__":{"BACK":{"target":"idle"}}}}',
    );
    const machine = new Fsm(instrumentFsmConfig(config, recorder));

    machine.send({ type: 'GO' });
    machine.send({ type: 'BACK' });

    expect(machine.state).toBe('idle');
    expect(
      recorder.entries
        .filter((entry) => entry.type === 'transition')
        .map((entry) => `${entry.from}->${entry.to}`),
    ).toEqual(['idle->__proto__', '__proto__->idle']);
  });

  it('checks only the recorder and fails like the core for invalid configs', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const config = createCallConfig();

    expect(() => instrumentFsmConfig(config, {})).toThrow(
      MESSAGES.invalidRecorder,
    );

    for (const invalid of [
      { ...config, initial: 'missing' },
      { ...config, transitions: { idle: { DIAL: undefined } } },
      { ...config, transitions: { idle: { DIAL: { target: 'missing' } } } },
    ]) {
      const expected = failureOf(() => new Fsm(invalid));
      expect(expected).toBeInstanceOf(Error);
      expect(
        failureOf(() => new Fsm(instrumentFsmConfig(invalid, recorder))),
      ).toEqual(expected);
    }
  });
});

describe('recordSource', () => {
  it('captures attach-time and delivered snapshots, using payloads for nested sends', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const machine = new Fsm(createCallConfig());
    recordSource(machine, recorder, { name: 'call' });
    machine.subscribe((snapshot) => {
      if (snapshot.value === 'dialing') machine.send({ type: 'CONNECT' });
    });

    machine.send({ type: 'DIAL', destination: '101' });

    expect(
      recorder.entries
        .filter((entry) => entry.type === 'commit')
        .map((entry) => entry.label),
    ).toEqual(['idle', 'dialing', 'connected']);
  });

  it('dedupes payload-delivered birth snapshots from hierarchy node handles', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const labels = [];
    const hierarchy = new FsmHierarchy(createRootConfig(), {
      onNodeSpawned: (node) => {
        if (node.path === 'active.active') {
          recordSource(node.handle, recorder, {
            name: node.path,
            label: (snapshot) => {
              labels.push(`${node.path}:${snapshot.value}:${snapshot.version}`);
              return snapshot.value;
            },
          });
        }
      },
    });

    hierarchy.send({ type: 'CONNECT' });

    expect(labels).toEqual(['active.active:active:0']);
  });

  it('uses default path labels, stops idempotently, and drops entries whose label throws', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const source = {
      snapshot: Object.freeze({ path: 'root.leaf' }),
      listener: null,
      subscribe(listener) {
        this.listener = listener;
        return () => {
          this.listener = null;
        };
      },
    };

    const subscription = recordSource(source, recorder, { name: 'tree' });
    expect(recorder.entries).toMatchObject([
      { type: 'commit', label: 'root.leaf' },
    ]);

    source.snapshot = Object.freeze({ path: 'root.other' });
    source.listener?.(source.snapshot);
    expect(recorder.entries).toHaveLength(2);

    subscription.stop();
    subscription.stop();
    source.snapshot = Object.freeze({ path: 'root.final' });
    source.listener?.(source.snapshot);
    expect(recorder.entries).toHaveLength(2);

    const broken = new InspectRecorder({ now: () => 1 });
    recordSource(source, broken, {
      name: 'broken',
      label: () => {
        throw new Error('label');
      },
    });
    expect(broken.entries).toEqual([]);

    // With anything but a recorder, every capture would drop.
    expect(() => recordSource(source, {}, { name: 'x' })).toThrow(
      MESSAGES.invalidRecorder,
    );
  });

  it('calls a label written as a method with the options as its receiver', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const machine = new Fsm(createCallConfig());
    recordSource(machine, recorder, {
      name: 'call',
      label() {
        return this.name;
      },
    });

    machine.send({ type: 'DIAL', destination: '101' });

    expect(recorder.entries.map((entry) => entry.label)).toEqual([
      'call',
      'call',
    ]);
  });

  it('reads source.snapshot when the listener gets no payload, with the same dedupe', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const source = {
      snapshot: { value: 'a' },
      listener: null,
      subscribe(listener) {
        this.listener = listener;
        return () => undefined;
      },
    };
    recordSource(source, recorder, { name: 'hand' });

    source.listener();
    source.snapshot = { value: 'b' };
    source.listener(undefined);
    source.listener();

    expect(recorder.entries.map((entry) => entry.label)).toEqual(['a', 'b']);
  });

  it('derives default and custom labels from mapped snapshots', () => {
    const recorder = new InspectRecorder({
      now: () => 1,
      mapSnapshot: () => ({ path: 'redacted.path' }),
    });
    const source = {
      snapshot: Object.freeze({ path: 'secret.path', token: 'secret' }),
      subscribe: () => () => undefined,
    };

    recordSource(source, recorder, { name: 'default' });
    recordSource(source, recorder, {
      name: 'custom',
      label: (snapshot) =>
        snapshot.token ? `leaked:${snapshot.token}` : snapshot.path,
    });

    expect(recorder.entries).toEqual([
      {
        type: 'commit',
        at: 1,
        name: 'default',
        label: 'redacted.path',
        snapshot: { path: 'redacted.path' },
      },
      {
        type: 'commit',
        at: 1,
        name: 'custom',
        label: 'redacted.path',
        snapshot: { path: 'redacted.path' },
      },
    ]);
  });
});

describe('Mermaid renderers', () => {
  it('skips undefined and null event maps, as the core does', () => {
    const diagram = mermaidFromFsmConfig({
      initial: 'idle',
      states: { idle: {}, done: {}, gone: {} },
      transitions: {
        idle: { GO: { target: 'done' } },
        done: undefined,
        gone: null,
      },
    });

    expect(diagram).toContain('idle --> done: GO');
  });

  it('reads flat config fields through getters', () => {
    class CallDiagram {
      get initial() {
        return 'idle';
      }
      get states() {
        return { idle: {}, done: {} };
      }
      get transitions() {
        return { idle: { GO: { target: 'done' } } };
      }
    }

    expect(mermaidFromFsmConfig(new CallDiagram())).toContain(
      'idle --> done: GO',
    );
  });

  it('renders flat diagrams with aliases, guards, wildcard notes, and escaping', () => {
    const diagram = mermaidFromFsmConfig({
      name: 'call',
      initial: 'idle',
      states: {
        idle: {},
        'dial:ing': {},
        ended: {},
        isolated: {},
      },
      transitions: {
        idle: {
          'DIAL:"101";`x`': { target: 'dial:ing', guard: () => true },
        },
        'dial:ing': {
          HANGUP: [{ target: 'ended' }, { target: 'idle', guard: () => true }],
        },
        ended: {},
        isolated: {},
        '*': {
          RESET: { target: 'idle' },
        },
      },
    });

    expect(diagram).toContain('state "isolated" as isolated');
    expect(diagram).toContain('state "dial#58;ing" as dial_ing');
    expect(diagram).toContain(
      'idle --> dial_ing: DIAL#58;#34;101#34;#59;#96;x#96; [guarded]',
    );
    expect(diagram).toContain('dial_ing --> ended: HANGUP');
    expect(diagram).toContain('dial_ing --> idle: HANGUP [guarded]');
    expect(diagram).toContain('note right of idle');
    expect(diagram).toContain('* -- RESET --> idle');
  });

  it('suffixes sanitized ids that collide', () => {
    const diagram = mermaidFromFsmConfig({
      initial: 'a_b',
      states: {
        a_b: {},
        'a b': {},
      },
      transitions: {
        a_b: { GO: { target: 'a b' } },
        'a b': { BACK: { target: 'a_b' } },
      },
    });

    expect(diagram).toContain('state "a_b" as a_b');
    expect(diagram).toContain('state "a b" as a_b_2');
    expect(diagram).toContain('a_b --> a_b_2: GO');
    expect(diagram).toContain('a_b_2 --> a_b: BACK');
  });

  it('escapes hashes before Mermaid can interpret entity-like text', () => {
    const diagram = mermaidFromFsmConfig({
      initial: 'idle',
      states: {
        idle: {},
        'ivr#menu': {},
      },
      transitions: {
        idle: { 'DTMF#3': { target: 'ivr#menu' }, '#59;': { target: 'idle' } },
        'ivr#menu': {},
        '*': { 'RESET#all': { target: 'idle' } },
      },
    });

    expect(diagram).toContain('state "ivr#35;menu" as ivr_menu');
    expect(diagram).toContain('idle --> ivr_menu: DTMF#35;3');
    expect(diagram).toContain('idle --> idle: #35;59#59;');
    expect(diagram).toContain('* -- RESET#35;all --> idle');
  });

  it('collapses newlines to spaces in names, labels, and notes', () => {
    const diagram = mermaidFromFsmConfig({
      initial: 'idle',
      states: { idle: {}, 'two\nlines': {} },
      transitions: {
        idle: { 'A\r\nB\rC': { target: 'two\nlines' } },
        '*': { 'RESET\n': { target: 'two\nlines' } },
      },
    });

    expect(diagram).toContain('state "two lines" as two_lines');
    expect(diagram).toContain('idle --> two_lines: A B C');
    expect(diagram).toContain('* -- RESET  --> two lines');
  });

  it('expands wildcard transitions except from states with their own entry', () => {
    const diagram = mermaidFromFsmConfig(
      {
        initial: 'a',
        states: { a: {}, b: {}, c: {} },
        transitions: {
          a: {},
          b: {},
          c: { RESET: { target: 'b' } },
          '*': { RESET: { target: 'a' } },
        },
      },
      { wildcard: 'expand' },
    );

    expect(diagram).toContain('a --> a: RESET');
    expect(diagram).toContain('b --> a: RESET');
    expect(diagram).toContain('c --> b: RESET');
    expect(diagram).not.toContain('c --> a: RESET');
    expect(diagram).not.toContain('note right of');
  });

  it('expands wildcards from a state whose name is an inherited key', () => {
    const config = JSON.parse(
      '{"initial":"idle","states":{"idle":{},"__proto__":{}},' +
        '"transitions":{"idle":{"GO":{"target":"__proto__"}},' +
        '"*":{"toString":{"target":"idle"}}}}',
    );
    const machine = new Fsm({ ...config, name: 'proto', context: {} });
    machine.send({ type: 'GO' });
    machine.send({ type: 'toString' });
    expect(machine.state).toBe('idle');

    const diagram = mermaidFromFsmConfig(config, { wildcard: 'expand' });
    expect(diagram).toContain('proto --> idle: toString');
  });

  it('marks a definition guarded only when its guard is truthy, as the core runs it', () => {
    const diagram = mermaidFromFsmConfig({
      initial: 'a',
      states: { a: {}, b: {} },
      transitions: {
        a: {
          GO: [
            { target: 'b', guard: null },
            { target: 'b', guard: () => true },
          ],
        },
      },
    });

    expect(diagram.split('\n')).toContain('  a --> b: GO');
    expect(diagram.split('\n')).toContain('  a --> b: GO [guarded]');
  });

  it('renders hierarchy diagrams with path-scoped ids for duplicate state names', () => {
    const diagram = mermaidFromHierarchyConfig({
      initial: 'active',
      states: { active: {}, idle: {} },
      transitions: {
        active: { STOP: { target: 'idle' } },
        idle: {},
        '*': {},
      },
      children: {
        active: {
          initial: 'active',
          states: { active: {}, muted: {} },
          transitions: {
            active: { MUTE: { target: 'muted' } },
            muted: { UNMUTE: { target: 'active' } },
            '*': { RESET: { target: 'active' } },
          },
        },
      },
    });

    expect(diagram).toBe(
      [
        'stateDiagram-v2',
        '  state "active" as active',
        '  state "idle" as idle',
        '  [*] --> active',
        '  active --> idle: STOP',
        '  state active {',
        '    state "active" as active_active',
        '    state "muted" as active_muted',
        '    [*] --> active_active',
        '    active_active --> active_muted: MUTE',
        '    active_muted --> active_active: UNMUTE',
        '    note right of active_active',
        '      active.* -- RESET --> active.active',
        '    end note',
        '  }',
        '',
      ].join('\n'),
    );
  });

  it('throws when a diagram references an undeclared state', () => {
    const flat = (overrides) =>
      mermaidFromFsmConfig({
        initial: 'a',
        states: { a: {} },
        transitions: {},
        ...overrides,
      });

    expect(() => flat({ initial: 'z' })).toThrow(MESSAGES.undeclaredState('z'));
    expect(() => flat({ transitions: { b: {} } })).toThrow(
      MESSAGES.undeclaredState('b'),
    );
    expect(() => flat({ transitions: { a: { GO: { target: 'b' } } } })).toThrow(
      MESSAGES.undeclaredState('b'),
    );
    expect(() =>
      flat({ transitions: { '*': { GO: [{ target: 'a' }, { nope: 'b' }] } } }),
    ).toThrow(MESSAGES.undeclaredState(undefined));

    const child = { initial: 'x', states: { x: {} }, transitions: {} };
    expect(() =>
      mermaidFromHierarchyConfig({
        initial: 'a',
        states: { a: {} },
        transitions: {},
        children: { b: child },
      }),
    ).toThrow(MESSAGES.undeclaredState('b'));
    expect(() =>
      mermaidFromHierarchyConfig({
        initial: 'a',
        states: { a: {} },
        transitions: {},
        children: { a: { ...child, initial: 'y' } },
      }),
    ).toThrow(MESSAGES.undeclaredState('y'));
  });
});
