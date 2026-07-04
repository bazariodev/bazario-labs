import type { Logger } from '@bazariodev/fsm';
import { describe, expect, it, vi } from 'vitest';
import { FsmHierarchy } from '../fsm-hierarchy.js';
import { MESSAGES } from '../internal/messages.js';
import type { HierarchyConfig } from '../types.js';

type Event =
  | { type: 'CONNECT' }
  | { type: 'START' }
  | { type: 'GO' }
  | { type: 'MUTE' }
  | { type: 'UNMUTE' }
  | { type: 'PING' }
  | { type: 'HANGUP' }
  | { type: 'FAIL' }
  | { type: 'SELF' };

type RootContext = { hangups: number };
type ChildContext = { pings: number };

const createLogger = (): Logger => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createChildConfig = (
  overrides: Partial<
    HierarchyConfig<'active' | 'muted', Event, ChildContext>
  > = {},
): HierarchyConfig<'active' | 'muted', Event, ChildContext> => ({
  name: 'connected-flow',
  initial: 'active',
  context: { pings: 0 },
  states: {
    active: overrides.states?.active ?? {},
    muted: overrides.states?.muted ?? {},
  },
  transitions: {
    active: {
      MUTE: { target: 'muted' },
      PING: {
        target: 'active',
        reducer: (context) => ({ pings: context.pings + 1 }),
      },
    },
    muted: {
      UNMUTE: { target: 'active' },
      PING: {
        target: 'muted',
        reducer: (context) => ({ pings: context.pings + 1 }),
      },
    },
    '*': {},
  },
  ...overrides,
});

const createRootConfig = (
  childConfig: HierarchyConfig<
    'active' | 'muted',
    Event,
    ChildContext
  > = createChildConfig(),
  overrides: Partial<
    HierarchyConfig<'idle' | 'connected' | 'failed', Event, RootContext>
  > = {},
): HierarchyConfig<'idle' | 'connected' | 'failed', Event, RootContext> => ({
  name: 'call-flow',
  initial: 'idle',
  context: { hangups: 0 },
  states: {
    idle: {},
    connected: {},
    failed: {},
  },
  transitions: {
    idle: {
      CONNECT: { target: 'connected' },
    },
    connected: {},
    failed: {},
    '*': {
      HANGUP: {
        target: 'failed',
        reducer: (context) => ({ hangups: context.hangups + 1 }),
      },
      FAIL: { target: 'failed' },
    },
  },
  children: {
    connected: childConfig,
  },
  ...overrides,
});

describe('FsmHierarchy', () => {
  it('spawns children after parent commits and composes snapshots', () => {
    const spawned: string[] = [];
    const hierarchy = new FsmHierarchy<Event>(createRootConfig(), {
      onNodeSpawned: (node) => {
        spawned.push(node.path);
      },
    });

    expect(hierarchy.snapshot).toMatchObject({
      treeVersion: 0,
      path: 'idle',
      root: { value: 'idle', path: 'idle', child: null },
    });

    hierarchy.send({ type: 'CONNECT' });

    expect(spawned).toEqual(['idle', 'connected.active']);
    expect(hierarchy.snapshot).toMatchObject({
      treeVersion: 1,
      path: 'connected.active',
      root: {
        value: 'connected',
        path: 'connected',
        child: {
          value: 'active',
          path: 'connected.active',
          child: null,
        },
      },
    });
    expect(hierarchy.matches('connected')).toBe(true);
    expect(hierarchy.matches('connected.active')).toBe(true);
    expect(hierarchy.matches('connectedness')).toBe(false);
    expect(hierarchy.nodeFor('connected')).toBeDefined();
    expect(hierarchy.nodeFor('connected.active')).toBeDefined();
    expect(hierarchy.nodeFor('idle')).toBeUndefined();
  });

  it('routes deepest-first, bubbles unhandled events, and disposes old children', () => {
    const cleanup = vi.fn();
    let retainedChild: ReturnType<FsmHierarchy<Event>['nodeFor']> | undefined;
    const hierarchy = new FsmHierarchy<Event>(createRootConfig(), {
      onNodeSpawned: (node) => {
        if (node.path === 'connected.active') {
          retainedChild = node.handle;
          return cleanup;
        }
      },
    });

    hierarchy.send({ type: 'CONNECT' });
    hierarchy.send({ type: 'MUTE' });

    expect(hierarchy.snapshot.path).toBe('connected.muted');
    expect(hierarchy.nodeFor('connected.muted')).toBeDefined();

    hierarchy.send({ type: 'HANGUP' });

    expect(hierarchy.snapshot.path).toBe('failed');
    expect(hierarchy.snapshot.root.context).toEqual({ hangups: 1 });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(hierarchy.nodeFor('connected.muted')).toBeUndefined();
    expect(retainedChild?.can({ type: 'MUTE' })).toBe(false);

    retainedChild?.send({ type: 'MUTE' });

    expect(hierarchy.snapshot.path).toBe('failed');
  });

  it('notifies affected node handles root-to-leaf before hierarchy subscribers', () => {
    const calls: string[] = [];
    const hierarchy = new FsmHierarchy<Event>(createRootConfig(), {
      onNodeSpawned: (node) => {
        node.handle.subscribe((snapshot) => {
          calls.push(`node:${node.path}:${snapshot.value}:${snapshot.version}`);
        });
      },
    });

    hierarchy.subscribe((snapshot) => {
      calls.push(`hierarchy:${snapshot.path}:${snapshot.treeVersion}`);
    });

    hierarchy.send({ type: 'CONNECT' });
    calls.length = 0;

    hierarchy.send({ type: 'MUTE' });

    expect(calls).toEqual([
      'node:connected.active:muted:1',
      'hierarchy:connected.muted:2',
    ]);
  });

  it('uses the captured composed snapshot when node subscribers send again', () => {
    const hierarchy = new FsmHierarchy<Event>(createRootConfig());
    const hierarchyCalls: Array<{
      path: string;
      treeVersion: number;
      pings: number;
    }> = [];

    hierarchy.send({ type: 'CONNECT' });
    hierarchy.nodeFor('connected.active')?.subscribe((snapshot) => {
      if (snapshot.value === 'muted' && snapshot.version === 1) {
        hierarchy.send({ type: 'PING' });
      }
    });
    hierarchy.subscribe((snapshot) => {
      hierarchyCalls.push({
        path: snapshot.path,
        treeVersion: snapshot.treeVersion,
        pings:
          (snapshot.root.child?.context as ChildContext | undefined)?.pings ??
          0,
      });
    });

    hierarchy.send({ type: 'MUTE' });

    expect(hierarchyCalls).toEqual([
      { path: 'connected.muted', treeVersion: 3, pings: 1 },
      { path: 'connected.muted', treeVersion: 2, pings: 0 },
    ]);
    expect(hierarchy.snapshot).toMatchObject({
      path: 'connected.muted',
      treeVersion: 3,
      root: {
        child: {
          context: { pings: 1 },
        },
      },
    });
  });

  it('allows subscribe during spawn but rejects synchronous send during reconciliation', () => {
    const calls: string[] = [];
    let canWhileSpawning: boolean | undefined;
    let sendWhileSpawningError: unknown;
    const hierarchy = new FsmHierarchy<Event>(createRootConfig(), {
      onNodeSpawned: (node) => {
        if (node.path !== 'connected.active') return;

        node.handle.subscribe((snapshot) => {
          calls.push(`${snapshot.value}:${snapshot.version}`);
        });

        canWhileSpawning = node.handle.can({ type: 'MUTE' });
        try {
          node.handle.send({ type: 'MUTE' });
        } catch (error) {
          sendWhileSpawningError = error;
        }
      },
    });

    hierarchy.send({ type: 'CONNECT' });
    hierarchy.send({ type: 'MUTE' });

    expect(canWhileSpawning).toBe(false);
    expect(sendWhileSpawningError).toEqual(
      new Error(MESSAGES.sendWhileReconciling),
    );
    expect(calls).toEqual(['active:0', 'muted:1']);
  });

  it('rejects hierarchy sends during reconciliation so a new child cannot clobber the active spine', () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    let hierarchy!: FsmHierarchy<Event>;
    const rejected: string[] = [];

    const childA: HierarchyConfig<'a0', Event, object> = {
      name: 'child-a',
      initial: 'a0',
      context: {},
      states: { a0: {} },
      transitions: { a0: {}, '*': {} },
    };
    const childB: HierarchyConfig<'b0', Event, object> = {
      name: 'child-b',
      initial: 'b0',
      context: {},
      states: { b0: {} },
      transitions: { b0: {}, '*': {} },
    };
    const root: HierarchyConfig<'idle' | 'A' | 'B', Event, object> = {
      name: 'root',
      initial: 'idle',
      context: {},
      states: { idle: {}, A: {}, B: {} },
      transitions: {
        idle: { START: { target: 'A' } },
        A: { GO: { target: 'B' } },
        B: {},
        '*': {},
      },
      children: { A: childA, B: childB },
    };

    hierarchy = new FsmHierarchy<Event>(root, {
      onNodeSpawned: (node) => {
        if (node.path === 'A.a0') {
          expect(() => hierarchy.send({ type: 'GO' })).toThrow(
            MESSAGES.sendWhileReconciling,
          );
          rejected.push(node.path);
          return cleanupA;
        }
        if (node.path === 'B.b0') return cleanupB;
      },
    });

    hierarchy.send({ type: 'START' });

    expect(rejected).toEqual(['A.a0']);
    expect(hierarchy.snapshot.path).toBe('A.a0');
    expect(hierarchy.nodeFor('A.a0')).toBeDefined();
    expect(hierarchy.nodeFor('B.b0')).toBeUndefined();
    expect(cleanupA).not.toHaveBeenCalled();
    expect(cleanupB).not.toHaveBeenCalled();

    hierarchy.send({ type: 'GO' });

    expect(hierarchy.snapshot.path).toBe('B.b0');
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).not.toHaveBeenCalled();
  });

  it('rejects hierarchy sends from child initial onEnter during reconciliation', () => {
    let hierarchy!: FsmHierarchy<Event>;
    const childA: HierarchyConfig<'a0', Event, object> = {
      name: 'child-a',
      initial: 'a0',
      context: {},
      states: {
        a0: {
          onEnter: () => hierarchy.send({ type: 'GO' }),
        },
      },
      transitions: { a0: {}, '*': {} },
    };
    const childB: HierarchyConfig<'b0', Event, object> = {
      name: 'child-b',
      initial: 'b0',
      context: {},
      states: { b0: {} },
      transitions: { b0: {}, '*': {} },
    };
    const root: HierarchyConfig<'idle' | 'A' | 'B', Event, object> = {
      name: 'root',
      initial: 'idle',
      context: {},
      states: { idle: {}, A: {}, B: {} },
      transitions: {
        idle: { START: { target: 'A' } },
        A: { GO: { target: 'B' } },
        B: {},
        '*': {},
      },
      children: { A: childA, B: childB },
    };

    hierarchy = new FsmHierarchy<Event>(root);

    expect(() => hierarchy.send({ type: 'START' })).toThrow(
      MESSAGES.sendWhileReconciling,
    );
    expect(hierarchy.can({ type: 'GO' })).toBe(false);
    expect(hierarchy.nodeFor('A.a0')).toBeUndefined();
    expect(hierarchy.nodeFor('B.b0')).toBeUndefined();
  });

  it('bumps treeVersion and notifies on non-structural transitions', () => {
    const snapshots: Array<{ path: string; version: number; pings: number }> =
      [];
    const hierarchy = new FsmHierarchy<Event>(createRootConfig());

    hierarchy.subscribe((snapshot) => {
      snapshots.push({
        path: snapshot.path,
        version: snapshot.treeVersion,
        pings:
          (snapshot.root.child?.context as ChildContext | undefined)?.pings ??
          0,
      });
    });

    hierarchy.send({ type: 'CONNECT' });
    hierarchy.send({ type: 'PING' });

    expect(snapshots).toEqual([
      { path: 'connected.active', version: 1, pings: 0 },
      { path: 'connected.active', version: 2, pings: 1 },
    ]);
  });

  it('re-entering a compound state resets its child to the child initial', () => {
    const hierarchy = new FsmHierarchy<Event>(
      createRootConfig(createChildConfig(), {
        transitions: {
          idle: {
            CONNECT: { target: 'connected' },
          },
          connected: {},
          failed: {
            CONNECT: { target: 'connected' },
          },
          '*': {
            HANGUP: { target: 'failed' },
          },
        },
      }),
    );

    hierarchy.send({ type: 'CONNECT' });
    const firstChild = hierarchy.nodeFor('connected.active');
    hierarchy.send({ type: 'MUTE' });
    hierarchy.send({ type: 'HANGUP' });
    hierarchy.send({ type: 'CONNECT' });

    expect(hierarchy.snapshot).toMatchObject({
      path: 'connected.active',
      root: {
        child: {
          value: 'active',
          context: { pings: 0 },
        },
      },
    });
    expect(firstChild?.can({ type: 'UNMUTE' })).toBe(false);
  });

  it('a live child handle can bubble to a parent that disposes that same child subtree', () => {
    const hierarchy = new FsmHierarchy<Event>(createRootConfig());

    hierarchy.send({ type: 'CONNECT' });
    const childHandle = hierarchy.nodeFor('connected.active');

    childHandle?.send({ type: 'HANGUP' });

    expect(hierarchy.snapshot.path).toBe('failed');
    expect(hierarchy.nodeFor('connected.active')).toBeUndefined();
    expect(childHandle?.can({ type: 'MUTE' })).toBe(false);

    childHandle?.send({ type: 'MUTE' });

    expect(hierarchy.snapshot.path).toBe('failed');
  });

  it('validates path and child config shape eagerly', () => {
    expect(
      () =>
        new FsmHierarchy<Event>(
          createRootConfig(createChildConfig(), {
            children: {
              missing: createChildConfig(),
            } as unknown as HierarchyConfig<
              'idle' | 'connected' | 'failed',
              Event,
              RootContext
            >['children'],
          }),
        ),
    ).toThrow(MESSAGES.childKeyMissing);

    expect(
      () =>
        new FsmHierarchy<Event>({
          ...createRootConfig(),
          states: {
            idle: {},
            'bad.name': {},
            failed: {},
          },
        } as unknown as HierarchyConfig<string, Event, RootContext>),
    ).toThrow(MESSAGES.stateNamesNoDot);

    expect(
      () =>
        new FsmHierarchy<Event>(
          createRootConfig(
            createChildConfig({
              initial: 'missing' as 'active',
            }),
          ),
        ),
    ).toThrow(MESSAGES.initialStateMissing);

    expect(
      () =>
        new FsmHierarchy<Event>(
          createRootConfig(
            createChildConfig({
              transitions: {
                active: {
                  GO: null,
                },
                muted: {},
                '*': {},
              } as unknown as HierarchyConfig<
                'active' | 'muted',
                Event,
                ChildContext
              >['transitions'],
            }),
          ),
        ),
    ).toThrow(MESSAGES.transitionTargetMissing);
  });

  it('ignores inherited child entries during reconciliation', () => {
    const cleanup = vi.fn();
    const inheritedChildren = Object.create({
      toString: {
        ...createChildConfig(),
        initial: 'active',
      },
    }) as HierarchyConfig<'idle' | 'toString', Event, object>['children'];
    const hierarchy = new FsmHierarchy<Event>(
      {
        name: 'root',
        initial: 'idle',
        context: {},
        states: {
          idle: {},
          toString: {},
        },
        transitions: {
          idle: { GO: { target: 'toString' } },
          toString: {},
          '*': {},
        },
        children: inheritedChildren,
      },
      {
        onNodeSpawned: () => cleanup,
      },
    );

    expect(() => hierarchy.send({ type: 'GO' })).not.toThrow();
    expect(hierarchy.snapshot.path).toBe('toString');
    expect(hierarchy.nodeFor('toString.active')).toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('rethrows child construction failures from the triggering send', () => {
    const logger = createLogger();
    const boom = new Error('child initial failed');
    const hierarchy = new FsmHierarchy<Event>(
      createRootConfig(
        createChildConfig({
          states: {
            active: {
              onEnter: () => {
                throw boom;
              },
            },
            muted: {},
          },
        }),
      ),
      { logger },
    );

    expect(() => hierarchy.send({ type: 'CONNECT' })).toThrow(boom);
    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.nodeConstructionFailed,
      expect.objectContaining({ error: boom }),
    );
    expect(hierarchy.can({ type: 'HANGUP' })).toBe(false);
  });

  it('contains onNodeSpawned callback failures and keeps the spawned node active', () => {
    const logger = createLogger();
    const boom = new Error('spawn failed');
    const hierarchy = new FsmHierarchy<Event>(createRootConfig(), {
      logger,
      onNodeSpawned: (node) => {
        if (node.path === 'connected.active') throw boom;
      },
    });

    hierarchy.send({ type: 'CONNECT' });
    hierarchy.send({ type: 'MUTE' });

    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.nodeSpawnCallbackFailed,
      expect.objectContaining({ path: 'connected.active', error: boom }),
    );
    expect(hierarchy.snapshot.path).toBe('connected.muted');
  });

  it('stops deepest-first with best-effort cleanups', () => {
    const calls: string[] = [];
    const logger = createLogger();
    const hierarchy = new FsmHierarchy<Event>(createRootConfig(), {
      logger,
      onNodeSpawned: (node) => {
        node.handle.subscribe(() => calls.push(`subscriber:${node.path}`));

        return () => {
          calls.push(`cleanup:${node.path}`);
          if (node.path === 'connected.active') throw new Error('cleanup');
        };
      },
    });

    hierarchy.subscribe(() => calls.push('hierarchy'));
    hierarchy.send({ type: 'CONNECT' });
    calls.length = 0;

    hierarchy.stop();
    hierarchy.send({ type: 'HANGUP' });

    expect(calls).toEqual(['cleanup:connected.active', 'cleanup:idle']);
    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.nodeCleanupFailed,
      expect.objectContaining({ path: 'connected.active' }),
    );
  });

  it('does not spawn a new child if stop is called from cleanup during reconciliation', () => {
    let hierarchy!: FsmHierarchy<Event>;
    const cleanupA = vi.fn(() => hierarchy.stop());
    const cleanupB = vi.fn();
    const spawnedB = vi.fn();
    const notifications: string[] = [];

    const childA: HierarchyConfig<'a0', Event, object> = {
      name: 'child-a',
      initial: 'a0',
      context: {},
      states: { a0: {} },
      transitions: { a0: {}, '*': {} },
    };
    const childB: HierarchyConfig<'b0', Event, object> = {
      name: 'child-b',
      initial: 'b0',
      context: {},
      states: { b0: {} },
      transitions: { b0: {}, '*': {} },
    };

    hierarchy = new FsmHierarchy<Event>(
      {
        name: 'root',
        initial: 'idle',
        context: {},
        states: { idle: {}, A: {}, B: {} },
        transitions: {
          idle: { START: { target: 'A' } },
          A: { GO: { target: 'B' } },
          B: {},
          '*': {},
        },
        children: { A: childA, B: childB },
      },
      {
        onNodeSpawned: (node) => {
          if (node.path === 'A.a0') return cleanupA;
          if (node.path === 'B.b0') {
            spawnedB();
            return cleanupB;
          }
        },
      },
    );

    hierarchy.subscribe((snapshot) => notifications.push(snapshot.path));
    hierarchy.send({ type: 'START' });
    notifications.length = 0;

    hierarchy.send({ type: 'GO' });

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(spawnedB).not.toHaveBeenCalled();
    expect(cleanupB).not.toHaveBeenCalled();
    expect(hierarchy.nodeFor('B.b0')).toBeUndefined();
    expect(hierarchy.can({ type: 'GO' })).toBe(false);
    expect(notifications).toEqual([]);
  });
});
