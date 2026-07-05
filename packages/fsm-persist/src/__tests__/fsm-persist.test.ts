import { Fsm, type FsmConfig, type Logger } from '@bazariodev/fsm';
import { FsmHierarchy, type HierarchyConfig } from '@bazariodev/fsm-hierarchy';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  FsmPersist,
  type HierarchyConfigLike,
  type HierarchySnapshotLike,
  loadRecord,
  type PersistRecord,
  type PersistStorage,
  persistFsm,
  persistHierarchy,
  restoreFsmConfig,
  restoreHierarchyConfig,
} from '../index.js';
import { MESSAGES } from '../internal/messages.js';

type CallState = 'idle' | 'dialing' | 'connected' | 'ended';
type CallEvent =
  | { type: 'DIAL'; destination: string }
  | { type: 'CONNECT' }
  | { type: 'HANGUP' };
type CallContext = { attempts: number; destination: string | null };

type HierarchyEvent =
  | { type: 'CONNECT' }
  | { type: 'MUTE' }
  | { type: 'UNMUTE' }
  | { type: 'PING' };
type RootContext = { calls: number };
type ChildContext = { pings: number };

class MemoryStorage implements PersistStorage {
  readonly values = new Map<string, string>();
  readonly getItem = vi.fn((key: string) => this.values.get(key) ?? null);
  readonly setItem = vi.fn((key: string, value: string) => {
    this.values.set(key, value);
  });
  readonly removeItem = vi.fn((key: string) => {
    this.values.delete(key);
  });
}

const createLogger = (): Logger => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createCallConfig = (
  overrides: Partial<FsmConfig<CallState, CallEvent, CallContext>> = {},
): FsmConfig<CallState, CallEvent, CallContext> => ({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0, destination: null },
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
          attempts: context.attempts + 1,
          destination:
            event.type === 'DIAL' ? event.destination : context.destination,
        }),
      },
    },
    dialing: {
      CONNECT: { target: 'connected' },
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
  overrides: Partial<
    HierarchyConfig<'idle' | 'connected', HierarchyEvent, RootContext>
  > = {},
): HierarchyConfig<'idle' | 'connected', HierarchyEvent, RootContext> => ({
  name: 'call-tree',
  initial: 'idle',
  context: { calls: 0 },
  states: {
    idle: overrides.states?.idle ?? {},
    connected: overrides.states?.connected ?? {},
  },
  transitions: {
    idle: {
      CONNECT: {
        target: 'connected',
        reducer: (context) => ({ calls: context.calls + 1 }),
      },
    },
    connected: {},
    '*': {},
  },
  children: {
    connected: childConfig,
  },
  ...overrides,
});

const readRecord = (storage: MemoryStorage, key = 'call'): PersistRecord =>
  JSON.parse(storage.values.get(key) ?? 'null') as PersistRecord;

describe('FsmPersist writer', () => {
  it('writes the initial snapshot and every committed transition', () => {
    const storage = new MemoryStorage();
    const machine = new Fsm(createCallConfig());

    persistFsm(machine, {
      storage,
      key: 'call',
      name: 'call',
      now: () => 10,
    });

    expect(readRecord(storage)).toMatchObject({
      format: 1,
      name: 'call',
      at: 10,
      state: { kind: 'fsm', value: 'idle' },
    });

    machine.send({ type: 'DIAL', destination: '101' });

    expect(readRecord(storage)).toMatchObject({
      state: {
        kind: 'fsm',
        value: 'dialing',
        context: { attempts: 1, destination: '101' },
      },
    });
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it('gates construction and transition writes through filter', () => {
    const storage = new MemoryStorage();
    const machine = new Fsm(createCallConfig());

    persistFsm(machine, {
      storage,
      key: 'call',
      name: 'call',
      filter: (snapshot) => snapshot.value !== 'dialing',
    });

    expect(readRecord(storage).state).toMatchObject({ value: 'idle' });

    machine.send({ type: 'DIAL', destination: '101' });

    expect(readRecord(storage).state).toMatchObject({ value: 'idle' });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('reads source.snapshot on notification and dedupes snapshot references', () => {
    type Snapshot = Readonly<{ value: string; context: unknown }>;
    const storage = new MemoryStorage();
    const source = {
      snapshot: Object.freeze({ value: 'a', context: {} }) as Snapshot,
      listener: null as (() => void) | null,
      subscribe(listener: () => void) {
        this.listener = listener;
        return () => {
          this.listener = null;
        };
      },
    };

    new FsmPersist(
      source,
      (snapshot) => ({
        kind: 'fsm',
        value: snapshot.value,
        context: snapshot.context,
      }),
      { storage, key: 'call', name: 'call' },
    );

    source.listener?.();
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    source.snapshot = Object.freeze({ value: 'b', context: {} });
    source.listener?.();

    expect(readRecord(storage).state).toMatchObject({ value: 'b' });
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it('contains write-pipeline failures and keeps the machine unaffected', () => {
    const storage = new MemoryStorage();
    const logger = createLogger();
    const machine = new Fsm(createCallConfig());

    persistFsm(machine, {
      storage,
      key: 'call',
      name: 'call',
      filter: (snapshot) => {
        if (snapshot.value === 'dialing') throw new Error('filter failed');
        return true;
      },
      logger,
    });

    machine.send({ type: 'DIAL', destination: '101' });

    expect(machine.state).toBe('dialing');
    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.writeFailed,
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('contains cyclic hierarchy snapshot writes', () => {
    const storage = new MemoryStorage();
    const logger = createLogger();
    type MutableHierarchyNode = {
      value: string;
      context: unknown;
      child: MutableHierarchyNode | null;
    };
    const node: MutableHierarchyNode = {
      value: 'connected',
      context: {},
      child: null,
    };
    node.child = node;

    persistHierarchy(
      {
        snapshot: { root: node },
        subscribe: () => () => undefined,
      },
      {
        storage,
        key: 'tree',
        name: 'call-tree',
        logger,
      },
    );

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.writeFailed,
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('contains serialize, setItem, now, and clear failures', () => {
    const storage = new MemoryStorage();
    const logger = createLogger();
    const machine = new Fsm(createCallConfig());

    new FsmPersist(
      machine,
      () => ({ kind: 'fsm', value: 'idle', context: {} }),
      {
        storage,
        key: 'call',
        name: 'call',
        serialize: () => {
          throw new Error('serialize failed');
        },
        logger,
      },
    );

    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.writeFailed,
      expect.objectContaining({ error: expect.any(Error) }),
    );

    const setItemStorage = new MemoryStorage();
    setItemStorage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    persistFsm(machine, {
      storage: setItemStorage,
      key: 'call',
      name: 'call',
      logger,
    });

    persistFsm(machine, {
      storage,
      key: 'now-fail',
      name: 'call',
      now: () => {
        throw new Error('clock');
      },
      logger,
    });

    storage.removeItem.mockImplementationOnce(() => {
      throw new Error('remove failed');
    });
    const persist = persistFsm(machine, { storage, key: 'call', name: 'call' });
    persist.clear();

    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.writeFailed,
      expect.objectContaining({ key: 'now-fail' }),
    );
  });

  it('stops without removing and clears without stopping', () => {
    const storage = new MemoryStorage();
    const machine = new Fsm(createCallConfig());
    const persist = persistFsm(machine, { storage, key: 'call', name: 'call' });

    persist.stop();
    persist.stop();
    machine.send({ type: 'DIAL', destination: '101' });
    expect(readRecord(storage).state).toMatchObject({ value: 'idle' });

    persist.clear();
    persist.clear();
    expect(storage.values.has('call')).toBe(false);
  });

  it('rejects malformed constructor inputs', () => {
    const storage = new MemoryStorage();
    const machine = new Fsm(createCallConfig());

    expect(
      () =>
        new FsmPersist(
          { snapshot: machine.snapshot } as unknown as typeof machine,
          () => ({ kind: 'fsm', value: 'idle', context: {} }),
          { storage, key: 'call', name: 'call' },
        ),
    ).toThrow(MESSAGES.invalidSource);

    expect(
      () =>
        new FsmPersist(machine, undefined as unknown as () => never, {
          storage,
          key: 'call',
          name: 'call',
        }),
    ).toThrow(MESSAGES.invalidToState);
  });
});

describe('flat restore', () => {
  it('restores value and context by construction', () => {
    const storage = new MemoryStorage();
    const config = createCallConfig();
    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 1,
        state: {
          kind: 'fsm',
          value: 'dialing',
          context: { attempts: 3, destination: '101' },
        },
      }),
    );

    const restored = restoreFsmConfig(config, { storage, key: 'call' });
    const machine = new Fsm(restored.config);

    expect(restored.restored).toBe(true);
    expect(machine.snapshot).toMatchObject({
      value: 'dialing',
      previousValue: null,
      version: 0,
      context: { attempts: 3, destination: '101' },
    });
    expect(config.initial).toBe('idle');
  });

  it('degrades to fresh start for absent, invalid, stale, wrong-kind, and unknown-state records', () => {
    const logger = createLogger();
    const storage = new MemoryStorage();
    const config = createCallConfig();

    expect(
      restoreFsmConfig(config, { storage, key: 'missing', logger }).restored,
    ).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      MESSAGES.noRecord,
      expect.objectContaining({ key: 'missing' }),
    );

    storage.setItem('call', '{');
    expect(
      restoreFsmConfig(config, { storage, key: 'call', logger }).restored,
    ).toBe(false);

    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 0,
        state: { kind: 'fsm', value: 'idle', context: {} },
      }),
    );
    expect(
      restoreFsmConfig(config, {
        storage,
        key: 'call',
        logger,
        maxAgeMs: 10,
        now: () => 11,
      }).restored,
    ).toBe(false);

    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 1,
        state: { kind: 'hierarchy', spine: [{ value: 'idle', context: {} }] },
      }),
    );
    expect(
      restoreFsmConfig(config, { storage, key: 'call', logger }).restored,
    ).toBe(false);

    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 1,
        state: { kind: 'fsm', value: 'missing', context: {} },
      }),
    );
    expect(
      restoreFsmConfig(config, { storage, key: 'call', logger }).restored,
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('contains storage and clock failures on read', () => {
    const logger = createLogger();
    const storage = new MemoryStorage();
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('denied');
    });

    expect(
      restoreFsmConfig(createCallConfig(), { storage, key: 'call', logger })
        .restored,
    ).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      MESSAGES.readFailed,
      expect.objectContaining({ error: expect.any(Error) }),
    );

    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 1,
        state: { kind: 'fsm', value: 'idle', context: {} },
      }),
    );

    expect(
      restoreFsmConfig(createCallConfig(), {
        storage,
        key: 'call',
        logger,
        maxAgeMs: 100,
        now: () => {
          throw new Error('clock');
        },
      }).restored,
    ).toBe(false);
  });

  it('rejects malformed reader options', () => {
    const storage = new MemoryStorage();

    expect(() =>
      restoreFsmConfig(createCallConfig(), {
        storage,
        key: 'call',
        maxAgeMs: Number.NaN,
      }),
    ).toThrow(MESSAGES.invalidMaxAge);

    expect(() =>
      loadRecord({
        storage,
        key: '',
        name: 'call',
      }),
    ).toThrow(MESSAGES.invalidKey);
  });

  it('loadRecord validates only the envelope and accepts either known kind', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 1,
        state: { kind: 'hierarchy', spine: [{ value: 'idle', context: {} }] },
      }),
    );

    expect(loadRecord({ storage, key: 'call', name: 'call' })).toMatchObject({
      state: { kind: 'hierarchy' },
    });

    storage.setItem(
      'call',
      JSON.stringify({
        format: 1,
        name: 'call',
        at: 1,
        state: { kind: 'hierarchy', spine: [] },
      }),
    );

    expect(loadRecord({ storage, key: 'call', name: 'call' })).toBeNull();
  });

  it('contains throwing getters returned from custom deserialize', () => {
    const storage = new MemoryStorage();
    const logger = createLogger();
    storage.setItem('call', 'custom');

    expect(() =>
      loadRecord({
        storage,
        key: 'call',
        name: 'call',
        logger,
        deserialize: () =>
          new Proxy(
            {},
            {
              get: () => {
                throw new Error('getter failed');
              },
            },
          ),
      }),
    ).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      MESSAGES.invalidRecord,
      expect.objectContaining({ reason: 'shape' }),
    );
  });

  it('roundtrips custom serialization for non-JSON-safe context', () => {
    const storage = new MemoryStorage();
    const config = createCallConfig();
    const value = new Map([['attempts', 5]]);

    persistFsm(new Fsm(createCallConfig({ context: value as never })), {
      storage,
      key: 'call',
      name: 'call',
      serialize: (record) =>
        JSON.stringify({
          ...record,
          state:
            record.state.kind === 'fsm'
              ? {
                  ...record.state,
                  context: [
                    ...(record.state.context as Map<string, number>).entries(),
                  ],
                }
              : record.state,
        }),
    });

    const restored = restoreFsmConfig(config, {
      storage,
      key: 'call',
      deserialize: (raw) => {
        const record = JSON.parse(raw) as PersistRecord;
        return {
          ...record,
          state:
            record.state.kind === 'fsm'
              ? {
                  ...record.state,
                  context: new Map(record.state.context as [string, number][]),
                }
              : record.state,
        };
      },
    });

    expect(restored.config.context).toBeInstanceOf(Map);
  });
});

describe('hierarchy restore', () => {
  it('roundtrips a deep active spine', () => {
    const storage = new MemoryStorage();
    const hierarchy = new FsmHierarchy<HierarchyEvent>(createRootConfig());
    persistHierarchy(hierarchy, {
      storage,
      key: 'tree',
      name: 'call-tree',
    });

    hierarchy.send({ type: 'CONNECT' });
    hierarchy.send({ type: 'MUTE' });
    hierarchy.send({ type: 'PING' });

    const restored = restoreHierarchyConfig(createRootConfig(), {
      storage,
      key: 'tree',
    });
    const next = new FsmHierarchy<HierarchyEvent>(restored.config);

    expect(restored).toMatchObject({
      restored: true,
      restoredLevels: 2,
      recordLevels: 2,
    });
    expect(next.snapshot).toMatchObject({
      treeVersion: 0,
      path: 'connected.muted',
      root: {
        value: 'connected',
        context: { calls: 1 },
        child: {
          value: 'muted',
          context: { pings: 1 },
        },
      },
    });
  });

  it('restores a valid prefix when a deeper child state no longer matches', () => {
    const logger = createLogger();
    const storage = new MemoryStorage();
    storage.setItem(
      'tree',
      JSON.stringify({
        format: 1,
        name: 'call-tree',
        at: 1,
        state: {
          kind: 'hierarchy',
          spine: [
            { value: 'connected', context: { calls: 2 } },
            { value: 'muted', context: { pings: 4 } },
          ],
        },
      }),
    );
    const renamedChild = createChildConfig({
      initial: 'active',
      states: {
        active: {},
        muted: undefined as never,
      } as never,
    });
    const config = createRootConfig({
      ...renamedChild,
      states: { active: {} },
      transitions: { active: {}, '*': {} },
    } as never);

    const restored = restoreHierarchyConfig(config, {
      storage,
      key: 'tree',
      logger,
    });
    const hierarchy = new FsmHierarchy<HierarchyEvent>(restored.config);

    expect(restored).toMatchObject({
      restored: true,
      restoredLevels: 1,
      recordLevels: 2,
    });
    expect(hierarchy.snapshot.path).toBe('connected.active');
    expect(logger.warn).toHaveBeenCalledWith(
      MESSAGES.partialHierarchyRestore,
      expect.objectContaining({ restoredLevels: 1, recordLevels: 2 }),
    );
  });

  it('restores nothing on root mismatch or kind mismatch', () => {
    const logger = createLogger();
    const storage = new MemoryStorage();
    storage.setItem(
      'tree',
      JSON.stringify({
        format: 1,
        name: 'call-tree',
        at: 1,
        state: {
          kind: 'hierarchy',
          spine: [{ value: 'missing', context: {} }],
        },
      }),
    );

    expect(
      restoreHierarchyConfig(createRootConfig(), {
        storage,
        key: 'tree',
        logger,
      }),
    ).toMatchObject({
      restored: false,
      restoredLevels: 0,
      recordLevels: 1,
    });

    storage.setItem(
      'tree',
      JSON.stringify({
        format: 1,
        name: 'call-tree',
        at: 1,
        state: { kind: 'fsm', value: 'idle', context: {} },
      }),
    );

    expect(
      restoreHierarchyConfig(createRootConfig(), {
        storage,
        key: 'tree',
        logger,
      }),
    ).toMatchObject({
      restored: false,
      restoredLevels: 0,
    });
  });

  it('does not mutate original config objects', () => {
    const storage = new MemoryStorage();
    const config = createRootConfig();
    storage.setItem(
      'tree',
      JSON.stringify({
        format: 1,
        name: 'call-tree',
        at: 1,
        state: {
          kind: 'hierarchy',
          spine: [
            { value: 'connected', context: { calls: 1 } },
            { value: 'muted', context: { pings: 1 } },
          ],
        },
      }),
    );

    restoreHierarchyConfig(config, { storage, key: 'tree' });

    expect(config.initial).toBe('idle');
    expect(config.children?.connected?.initial).toBe('active');
  });

  it('keeps structural hierarchy types compatible with the real package', () => {
    expectTypeOf<
      import('@bazariodev/fsm-hierarchy').HierarchySnapshot
    >().toExtend<HierarchySnapshotLike>();
    expectTypeOf<
      import('@bazariodev/fsm-hierarchy').AnyHierarchyConfig<HierarchyEvent>
    >().toExtend<HierarchyConfigLike>();
  });
});
