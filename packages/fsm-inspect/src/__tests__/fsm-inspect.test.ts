import { Fsm, type FsmConfig } from '@bazariodev/fsm';
import {
  type AnyHierarchyConfig,
  FsmHierarchy,
  type HierarchyConfig,
  type HierarchySnapshot,
} from '@bazariodev/fsm-hierarchy';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type FsmDiagramConfig,
  type FsmSubscribable,
  type HierarchyDiagramConfig,
  InspectRecorder,
  instrumentFsmConfig,
  mermaidFromFsmConfig,
  mermaidFromHierarchyConfig,
  recordSource,
} from '../index.js';
import { MESSAGES } from '../internal/messages.js';

type CallState = 'idle' | 'dialing' | 'connected' | 'ended';
type CallEvent =
  | { type: 'DIAL'; destination: string; token?: string }
  | { type: 'CONNECT' }
  | { type: 'HANGUP' }
  | { type: 'SELF' };
type CallContext = {
  attempts: number;
  destination: string | null;
  token?: string;
};

type HierarchyEvent =
  | { type: 'CONNECT' }
  | { type: 'MUTE' }
  | { type: 'UNMUTE' }
  | { type: 'PING' };
type RootContext = { calls: number };
type ChildContext = { pings: number };

const createCallConfig = (
  overrides: Partial<FsmConfig<CallState, CallEvent, CallContext>> = {},
): FsmConfig<CallState, CallEvent, CallContext> => ({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0, destination: null, token: 'secret' },
  states: {
    idle: overrides.states?.idle ?? {},
    dialing: overrides.states?.dialing ?? {},
    connected: overrides.states?.connected ?? {},
    ended: overrides.states?.ended ?? {},
  },
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

const createChildConfig = (
  overrides: Partial<
    HierarchyConfig<'active' | 'muted', HierarchyEvent, ChildContext>
  > = {},
): HierarchyConfig<'active' | 'muted', HierarchyEvent, ChildContext> => ({
  name: 'child',
  initial: 'active',
  context: { pings: 0 },
  states: {
    active: overrides.states?.active ?? {},
    muted: overrides.states?.muted ?? {},
  },
  transitions: {
    active: { MUTE: { target: 'muted' } },
    muted: { UNMUTE: { target: 'active' } },
    '*': {},
  },
  ...overrides,
});

const createRootConfig = (
  childConfig = createChildConfig(),
): HierarchyConfig<'idle' | 'active', HierarchyEvent, RootContext> => ({
  name: 'root',
  initial: 'idle',
  context: { calls: 0 },
  states: {
    idle: {},
    active: {},
  },
  transitions: {
    idle: { CONNECT: { target: 'active' } },
    active: {},
    '*': {},
  },
  children: { active: childConfig },
});

describe('InspectRecorder', () => {
  it('keeps a bounded frozen ring buffer with cached defensive reads', () => {
    const recorder = new InspectRecorder({ limit: 2 });
    const first = {
      type: 'log',
      at: 1,
      level: 'debug',
      message: 'a',
    } as const;

    recorder.record(first);
    recorder.record({ type: 'log', at: 2, level: 'warn', message: 'b' });

    const read = recorder.entries;
    expect(Object.isFrozen(read)).toBe(true);
    expect(recorder.entries).toBe(read);
    expect(() => {
      (read as unknown[]).push({});
    }).toThrow();

    recorder.record({ type: 'log', at: 3, level: 'error', message: 'c' });

    expect(recorder.entries).not.toBe(read);
    expect(recorder.entries.map((entry) => entry.at)).toEqual([2, 3]);
  });

  it('stores shallow-frozen copies and calls onEntry after buffering', () => {
    const seen: unknown[] = [];
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
    } as const;

    recorder.record(entry);
    (entry as { message: string }).message = 'after';

    expect(recorder.entries[0]).toMatchObject({ message: 'before' });
    expect(Object.isFrozen(recorder.entries[0])).toBe(true);
    expect(seen).toEqual([recorder.entries[0]]);
  });

  it('maps logger metadata and drops logger entries when now or mapMeta fails', () => {
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

    const brokenNow = new InspectRecorder({ now: () => Number.NaN });
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
    expect(
      () => new InspectRecorder({ mapEvent: true as unknown as () => unknown }),
    ).toThrow(MESSAGES.invalidMapEvent);
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
    const calls: string[] = [];
    const recorder = new InspectRecorder({
      now: () => 1,
      onEntry: (entry) => calls.push(entry.type),
    });
    const config = createCallConfig({
      onTransitionStart: () => calls.push('consumer-start'),
      states: {
        ...createCallConfig().states,
        dialing: {
          onEnter: () => {
            throw new Error('enter failed');
          },
        },
      },
    });
    const machine = new Fsm(instrumentFsmConfig(config, recorder));

    expect(() => machine.send({ type: 'DIAL', destination: '101' })).toThrow(
      'enter failed',
    );

    expect(calls).toEqual(['init', 'transition-start', 'consumer-start']);
    expect(
      recorder.entries.filter((entry) => entry.type === 'transition'),
    ).toEqual([]);
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
    let second: Fsm<CallState, CallEvent, CallContext> | null = null;
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
      recorder.entries
        .filter(
          (entry) =>
            entry.type === 'transition-start' || entry.type === 'transition',
        )
        .map((entry) => ({
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
      recorder.entries
        .filter(
          (entry) =>
            entry.type === 'transition-start' || entry.type === 'transition',
        )
        .map((entry) => ({
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

  it('fails fast instead of masking invalid wrapped hooks or initial state', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    const config = createCallConfig();

    expect(() =>
      instrumentFsmConfig(
        {
          ...config,
          onTransitionStart: true as unknown as NonNullable<
            typeof config.onTransitionStart
          >,
        },
        recorder,
      ),
    ).toThrow(MESSAGES.invalidConfig);

    expect(() =>
      instrumentFsmConfig(
        {
          ...config,
          states: {
            ...config.states,
            idle: { onEnter: true as unknown as () => void },
          },
        },
        recorder,
      ),
    ).toThrow(MESSAGES.invalidConfig);

    expect(() =>
      instrumentFsmConfig({ ...config, initial: 'ended' }, recorder),
    ).not.toThrow();

    expect(() =>
      instrumentFsmConfig(
        {
          ...config,
          initial: 'missing' as CallState,
        },
        recorder,
      ),
    ).toThrow(MESSAGES.invalidConfig);
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
    const labels: string[] = [];
    const hierarchy = new FsmHierarchy<HierarchyEvent>(createRootConfig(), {
      onNodeSpawned: (node) => {
        if (node.path === 'active.active') {
          recordSource(node.handle, recorder, {
            name: node.path,
            label: (snapshot) => {
              const mapped = snapshot as { value: string; version: number };
              labels.push(`${node.path}:${mapped.value}:${mapped.version}`);
              return mapped.value;
            },
          });
        }
      },
    });

    hierarchy.send({ type: 'CONNECT' });

    expect(labels).toEqual(['active.active:active:0']);
  });

  it('uses custom labels, default path labels, stop, and fail-silent label errors', () => {
    const recorder = new InspectRecorder({ now: () => 1 });
    type PathSnapshot = Readonly<{ path: string }>;
    const source = {
      snapshot: Object.freeze({ path: 'root.leaf' }) as PathSnapshot,
      listener: null as ((snapshot?: PathSnapshot) => void) | null,
      subscribe(listener: (snapshot?: PathSnapshot) => void) {
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

    expect(() =>
      recordSource(source, recorder, undefined as unknown as { name: string }),
    ).toThrow(MESSAGES.invalidName);
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
      label: (snapshot) => {
        const mapped = snapshot as { path: string; token?: string };
        return mapped.token ? `leaked:${mapped.token}` : mapped.path;
      },
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
  it('skips transition sources that are explicitly undefined', () => {
    const diagram = mermaidFromFsmConfig({
      initial: 'idle',
      states: { idle: {}, done: {} },
      transitions: { idle: { GO: { target: 'done' } }, done: undefined },
    });

    expect(diagram).toContain('GO');
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

    expect(diagram).toContain('state isolated');
    expect(diagram).toContain('state "dial#58;ing" as dial_ing');
    expect(diagram).toContain(
      'idle --> dial_ing: DIAL#58;#quot;101#quot;#59;#96;x#96; [guarded]',
    );
    expect(diagram).toContain('dial_ing --> ended: HANGUP');
    expect(diagram).toContain('dial_ing --> idle: HANGUP [guarded]');
    expect(diagram).toContain('note right of idle');
    expect(diagram).toContain('* -- RESET --> idle');
  });

  it('keeps flat sanitized ids from colliding with safe state names', () => {
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

    expect(diagram).toContain('state a_b');
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
        idle: { 'DTMF#3': { target: 'ivr#menu' } },
        'ivr#menu': {},
        '*': { 'RESET#all': { target: 'idle' } },
      },
    });

    expect(diagram).toContain('state "ivr#35;menu" as ivr_menu');
    expect(diagram).toContain('idle --> ivr_menu: DTMF#35;3');
    expect(diagram).toContain('* -- RESET#35;all --> idle');
  });

  it('expands wildcard transitions when requested', () => {
    const diagram = mermaidFromFsmConfig(
      {
        initial: 'a',
        states: { a: {}, b: {} },
        transitions: {
          a: {},
          b: {},
          '*': { RESET: { target: 'a' } },
        },
      },
      { wildcard: 'expand' },
    );

    expect(diagram).toContain('a --> a: RESET');
    expect(diagram).toContain('b --> a: RESET');
    expect(diagram).not.toContain('note right of');
  });

  it('renders hierarchy diagrams with path-scoped ids for duplicate state names', () => {
    const config: HierarchyDiagramConfig = {
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
            '*': {},
          },
        },
      },
    };

    const diagram = mermaidFromHierarchyConfig(config);

    expect(diagram).toContain('state "active" as active');
    expect(diagram).toContain('state active {');
    expect(diagram).toContain('state "active" as active_active');
    expect(diagram).toContain('active_active --> active_muted: MUTE');
    expect(diagram).toContain('active --> idle: STOP');
  });

  it('throws on malformed diagram input and options', () => {
    expect(() =>
      mermaidFromFsmConfig({
        initial: 'a',
        states: { a: {} },
        transitions: { a: { GO: { nope: 'b' } } },
      }),
    ).toThrow(MESSAGES.invalidTransitionEntry);

    expect(() =>
      mermaidFromFsmConfig(
        {
          initial: 'a',
          states: { a: {} },
          transitions: { a: {} },
        },
        { wildcard: 'dense' as 'note' },
      ),
    ).toThrow(MESSAGES.invalidMermaidOptions);

    expect(() =>
      mermaidFromHierarchyConfig(
        {
          initial: 'a',
          states: { a: {} },
          transitions: { a: {} },
        },
        null as unknown as Record<string, never>,
      ),
    ).toThrow(MESSAGES.invalidMermaidOptions);
  });
});

describe('structural compatibility', () => {
  it('accepts real FSM and hierarchy shapes structurally', () => {
    expectTypeOf<
      FsmConfig<CallState, CallEvent, CallContext>
    >().toExtend<FsmDiagramConfig>();
    expectTypeOf<
      AnyHierarchyConfig<HierarchyEvent>
    >().toExtend<HierarchyDiagramConfig>();
    expectTypeOf<Fsm<CallState, CallEvent, CallContext>>().toExtend<
      FsmSubscribable<
        import('@bazariodev/fsm').FsmSnapshot<CallState, CallContext>
      >
    >();
    expectTypeOf<FsmHierarchy<HierarchyEvent>>().toExtend<
      FsmSubscribable<HierarchySnapshot>
    >();
  });
});
