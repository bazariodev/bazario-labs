import { describe, expect, it, vi } from 'vitest';
import { FsmHierarchy } from '../index.js';
import { MESSAGES } from '../internal/messages.js';

const createLogger = () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createChildConfig = (overrides = {}) => ({
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
  childConfig = createChildConfig(),
  overrides = {},
) => ({
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
  it('accepts transition sources that are explicitly undefined', () => {
    const hierarchy = new FsmHierarchy(
      createRootConfig(undefined, {
        transitions: {
          idle: { CONNECT: { target: 'connected' } },
          connected: undefined,
        },
      }),
    );

    hierarchy.send({ type: 'CONNECT' });

    expect(hierarchy.snapshot.path).toBe('connected.active');
  });

  it('spawns children after parent commits and composes snapshots', () => {
    const spawned = [];
    const hierarchy = new FsmHierarchy(createRootConfig(), {
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
    let retainedChild;
    const hierarchy = new FsmHierarchy(createRootConfig(), {
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
    const calls = [];
    const hierarchy = new FsmHierarchy(createRootConfig(), {
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

  it('never delivers an older node snapshot after a newer one to later subscribers', () => {
    const hierarchy = new FsmHierarchy(createRootConfig());
    const seen = [];

    hierarchy.send({ type: 'CONNECT' });
    const node = hierarchy.nodeFor('connected.active');
    node?.subscribe((snapshot) => {
      if (snapshot.value === 'muted' && snapshot.version === 1) {
        hierarchy.send({ type: 'PING' });
      }
    });
    node?.subscribe((snapshot) => seen.push(snapshot.version));

    hierarchy.send({ type: 'MUTE' });

    expect(seen).toEqual([2]);
    expect(node?.snapshot.version).toBe(2);
  });

  it('never delivers an older snapshot after a newer one when node subscribers send again', () => {
    const hierarchy = new FsmHierarchy(createRootConfig());
    const hierarchyCalls = [];

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
        pings: snapshot.root.child?.context?.pings ?? 0,
      });
    });

    hierarchy.send({ type: 'MUTE' });

    // The nested PING publishes treeVersion 3 first; the outer treeVersion 2 is skipped.
    expect(hierarchyCalls).toEqual([
      { path: 'connected.muted', treeVersion: 3, pings: 1 },
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
    const calls = [];
    let canWhileSpawning;
    let sendWhileSpawningError;
    const hierarchy = new FsmHierarchy(createRootConfig(), {
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
    let hierarchy;
    const rejected = [];

    const childA = {
      name: 'child-a',
      initial: 'a0',
      context: {},
      states: { a0: {} },
      transitions: { a0: {}, '*': {} },
    };
    const childB = {
      name: 'child-b',
      initial: 'b0',
      context: {},
      states: { b0: {} },
      transitions: { b0: {}, '*': {} },
    };
    const root = {
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

    hierarchy = new FsmHierarchy(root, {
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
    let hierarchy;
    const childA = {
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
    const childB = {
      name: 'child-b',
      initial: 'b0',
      context: {},
      states: { b0: {} },
      transitions: { b0: {}, '*': {} },
    };
    const root = {
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

    hierarchy = new FsmHierarchy(root);

    expect(() => hierarchy.send({ type: 'START' })).toThrow(
      MESSAGES.sendWhileReconciling,
    );
    expect(hierarchy.can({ type: 'GO' })).toBe(false);
    expect(hierarchy.nodeFor('A.a0')).toBeUndefined();
    expect(hierarchy.nodeFor('B.b0')).toBeUndefined();
  });

  it('bumps treeVersion and notifies on non-structural transitions', () => {
    const snapshots = [];
    const hierarchy = new FsmHierarchy(createRootConfig());

    hierarchy.subscribe((snapshot) => {
      snapshots.push({
        path: snapshot.path,
        version: snapshot.treeVersion,
        pings: snapshot.root.child?.context?.pings ?? 0,
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
    const hierarchy = new FsmHierarchy(
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
    const hierarchy = new FsmHierarchy(createRootConfig());

    hierarchy.send({ type: 'CONNECT' });
    const childHandle = hierarchy.nodeFor('connected.active');

    childHandle?.send({ type: 'HANGUP' });

    expect(hierarchy.snapshot.path).toBe('failed');
    expect(hierarchy.nodeFor('connected.active')).toBeUndefined();
    expect(childHandle?.can({ type: 'MUTE' })).toBe(false);

    childHandle?.send({ type: 'MUTE' });

    expect(hierarchy.snapshot.path).toBe('failed');
  });

  it('rejects invalid state definitions in inactive children at construction', () => {
    const withState = (states) =>
      createRootConfig(
        createChildConfig({ states: { active: {}, muted: {}, ...states } }),
      );

    expect(() => new FsmHierarchy(withState({ later: null }))).toThrow(
      MESSAGES.stateDefinitionsObject,
    );
    expect(
      () => new FsmHierarchy(withState({ muted: { onEnter: 42 } })),
    ).toThrow(MESSAGES.stateHookNotFunction('muted', 'onEnter'));
  });

  it('rejects empty state names, which would vanish from paths', () => {
    const root = {
      name: 'root',
      initial: '',
      context: {},
      states: { '': {} },
      transitions: {},
    };
    const child = createChildConfig({
      states: { active: {}, muted: {}, '': {} },
    });

    expect(() => new FsmHierarchy(root)).toThrow(MESSAGES.stateNameEmpty);
    expect(() => new FsmHierarchy(createRootConfig(child))).toThrow(
      MESSAGES.stateNameEmpty,
    );
  });

  it('rejects a non-string initial state in an inactive child', () => {
    const child = createChildConfig({ initial: 0, states: { 0: {} } });

    expect(() => new FsmHierarchy(createRootConfig(child))).toThrow(
      MESSAGES.initialStateString,
    );
  });

  it('rejects graph containers that are not plain objects', () => {
    const child = createChildConfig();

    expect(
      () =>
        new FsmHierarchy(
          createRootConfig(child, {
            children: new Map([['connected', child]]),
          }),
        ),
    ).toThrow(MESSAGES.childrenNotObject);
    expect(
      () => new FsmHierarchy(createRootConfig(child, { transitions: [] })),
    ).toThrow(MESSAGES.transitionsNotObject);
    expect(
      () => new FsmHierarchy(createRootConfig(child, { states: new Map() })),
    ).toThrow(MESSAGES.statesNotObject);
    expect(
      () => new FsmHierarchy(createRootConfig(child, { children: new Date() })),
    ).toThrow(MESSAGES.childrenNotObject);
    expect(
      () =>
        new FsmHierarchy(createRootConfig(child, { transitions: new Date() })),
    ).toThrow(MESSAGES.transitionsNotObject);
    expect(
      () =>
        new FsmHierarchy(
          createRootConfig(child, { transitions: { idle: [] } }),
        ),
    ).toThrow(MESSAGES.transitionSourceEventMap);
  });

  it('validates path and child config shape eagerly', () => {
    expect(
      () =>
        new FsmHierarchy(
          createRootConfig(createChildConfig(), {
            children: {
              missing: createChildConfig(),
            },
          }),
        ),
    ).toThrow(MESSAGES.childKeyMissing);

    expect(
      () =>
        new FsmHierarchy({
          ...createRootConfig(),
          states: {
            idle: {},
            'bad.name': {},
            failed: {},
          },
        }),
    ).toThrow(MESSAGES.stateNamesNoDot);

    expect(
      () =>
        new FsmHierarchy(
          createRootConfig(
            createChildConfig({
              initial: 'missing',
            }),
          ),
        ),
    ).toThrow(MESSAGES.initialStateMissing);

    expect(
      () =>
        new FsmHierarchy(
          createRootConfig(
            createChildConfig({
              transitions: {
                active: {
                  GO: null,
                },
                muted: {},
                '*': {},
              },
            }),
          ),
        ),
    ).toThrow(MESSAGES.transitionTargetMissing);
  });

  it('rejects children with a custom prototype and ignores inherited keys', () => {
    const config = (children) => ({
      name: 'root',
      initial: 'idle',
      context: {},
      states: { idle: {}, toString: {} },
      transitions: { idle: { GO: { target: 'toString' } } },
      children,
    });
    const inheritedChildren = Object.create({
      toString: { ...createChildConfig(), initial: 'active' },
    });

    expect(() => new FsmHierarchy(config(inheritedChildren))).toThrow(
      MESSAGES.childrenNotObject,
    );

    // Object.prototype.toString is inherited, never read as a child config.
    const cleanup = vi.fn();
    const hierarchy = new FsmHierarchy(config({}), {
      onNodeSpawned: () => cleanup,
    });

    expect(() => hierarchy.send({ type: 'GO' })).not.toThrow();
    expect(hierarchy.snapshot.path).toBe('toString');
    expect(hierarchy.nodeFor('toString.active')).toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('rethrows child construction failures from the triggering send', () => {
    const logger = createLogger();
    const boom = new Error('child initial failed');
    const hierarchy = new FsmHierarchy(
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
    const hierarchy = new FsmHierarchy(createRootConfig(), {
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
    const calls = [];
    const logger = createLogger();
    const hierarchy = new FsmHierarchy(createRootConfig(), {
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
    let hierarchy;
    const cleanupA = vi.fn(() => hierarchy.stop());
    const cleanupB = vi.fn();
    const spawnedB = vi.fn();
    const notifications = [];

    const childA = {
      name: 'child-a',
      initial: 'a0',
      context: {},
      states: { a0: {} },
      transitions: { a0: {}, '*': {} },
    };
    const childB = {
      name: 'child-b',
      initial: 'b0',
      context: {},
      states: { b0: {} },
      transitions: { b0: {}, '*': {} },
    };

    hierarchy = new FsmHierarchy(
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
