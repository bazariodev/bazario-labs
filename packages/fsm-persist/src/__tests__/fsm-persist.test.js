import { Fsm } from '@bazariodev/fsm';
import { FsmHierarchy } from '@bazariodev/fsm-hierarchy';
import { describe, expect, it, vi } from 'vitest';

import {
  FsmPersist,
  loadRecord,
  persistFsm,
  persistHierarchy,
  restoreFsmConfig,
  restoreHierarchyConfig,
} from '../index.js';
import { MESSAGES } from '../internal/messages.js';

class MemoryStorage {
  values = new Map();
  getItem = vi.fn((key) => this.values.get(key) ?? null);
  setItem = vi.fn((key, value) => {
    this.values.set(key, value);
  });
  removeItem = vi.fn((key) => {
    this.values.delete(key);
  });
}

const createLogger = () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createCallConfig = (overrides = {}) => ({
  name: 'call',
  initial: 'idle',
  context: { attempts: 0, destination: null },
  states: { idle: {}, dialing: {}, connected: {}, ended: {} },
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

const createChildConfig = (overrides = {}) => ({
  name: 'connected-flow',
  initial: 'active',
  context: { pings: 0 },
  states: { active: {}, muted: {} },
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
  name: 'call-tree',
  initial: 'idle',
  context: { calls: 0 },
  states: { idle: {}, connected: {} },
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

const readRecord = (storage, key = 'call') =>
  JSON.parse(storage.values.get(key) ?? 'null');

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
    const storage = new MemoryStorage();
    const source = {
      snapshot: Object.freeze({ value: 'a', context: {} }),
      listener: null,
      subscribe(listener) {
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

    const node = {
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

  it('contains endless acyclic hierarchy snapshot writes', () => {
    const storage = new MemoryStorage();
    const logger = createLogger();
    // Every read of `child` returns a fresh node, so no node ever repeats.
    const createNode = () => ({
      value: 'connected',
      context: {},
      get child() {
        return createNode();
      },
    });

    persistHierarchy(
      {
        snapshot: { root: createNode() },
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
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'hierarchy snapshot exceeds maximum persisted depth',
        }),
      }),
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

  it('clears without stopping and stops without removing', () => {
    const storage = new MemoryStorage();
    const machine = new Fsm(createCallConfig());
    const persist = persistFsm(machine, { storage, key: 'call', name: 'call' });

    persist.clear();
    persist.clear();
    expect(storage.values.has('call')).toBe(false);

    machine.send({ type: 'DIAL', destination: '101' });
    expect(readRecord(storage).state).toMatchObject({ value: 'dialing' });

    persist.stop();
    persist.stop();
    machine.send({ type: 'CONNECT' });
    expect(readRecord(storage).state).toMatchObject({ value: 'dialing' });
  });

  it('rejects malformed constructor inputs', () => {
    const storage = new MemoryStorage();
    const machine = new Fsm(createCallConfig());

    expect(
      () =>
        new FsmPersist(
          { snapshot: machine.snapshot },
          () => ({ kind: 'fsm', value: 'idle', context: {} }),
          { storage, key: 'call', name: 'call' },
        ),
    ).toThrow(MESSAGES.invalidSource);

    expect(
      () =>
        new FsmPersist(machine, undefined, {
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

  it('keeps the envelope values it validated when getters change between reads', () => {
    const storage = new MemoryStorage();
    storage.setItem('call', 'custom');
    // Answers the first read with `valid` and every later read with `later`.
    const firstRead = (valid, later) => {
      let read = false;
      return () => {
        const result = read ? later : valid;
        read = true;
        return result;
      };
    };
    const unusableKey = {
      toString() {
        throw new Error('not a property key');
      },
    };
    const deserialize = () => {
      const at = firstRead(0, Symbol('at'));
      const value = firstRead('dialing', unusableKey);
      return {
        format: 1,
        name: 'call',
        get at() {
          return at();
        },
        state: {
          kind: 'fsm',
          get value() {
            return value();
          },
          context: { attempts: 1, destination: '101' },
        },
      };
    };
    const options = {
      storage,
      key: 'call',
      name: 'call',
      deserialize,
      maxAgeMs: 100,
      now: () => 50,
    };

    expect(loadRecord(options)).toMatchObject({
      at: 0,
      state: { kind: 'fsm', value: 'dialing' },
    });
    expect(restoreFsmConfig(createCallConfig(), options)).toMatchObject({
      restored: true,
      config: { initial: 'dialing' },
    });
  });

  it('roundtrips custom serialization for non-JSON-safe context', () => {
    const storage = new MemoryStorage();
    const config = createCallConfig();
    const value = new Map([['attempts', 5]]);

    persistFsm(new Fsm(createCallConfig({ context: value })), {
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
                  context: [...record.state.context.entries()],
                }
              : record.state,
        }),
    });

    const restored = restoreFsmConfig(config, {
      storage,
      key: 'call',
      deserialize: (raw) => {
        const record = JSON.parse(raw);
        return {
          ...record,
          state:
            record.state.kind === 'fsm'
              ? {
                  ...record.state,
                  context: new Map(record.state.context),
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
    const hierarchy = new FsmHierarchy(createRootConfig());
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
    const next = new FsmHierarchy(restored.config);

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
        muted: undefined,
      },
    });
    const config = createRootConfig({
      ...renamedChild,
      states: { active: {} },
      transitions: { active: {}, '*': {} },
    });

    const restored = restoreHierarchyConfig(config, {
      storage,
      key: 'tree',
      logger,
    });
    const hierarchy = new FsmHierarchy(restored.config);

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

  it('rejects sparse spines from a custom deserialize as invalid records', () => {
    const storage = new MemoryStorage();
    storage.setItem('tree', 'custom');
    const rootHole = new Array(1);
    const trailingHole = [{ value: 'connected', context: { calls: 1 } }];
    trailingHole.length = 2;

    for (const spine of [rootHole, trailingHole]) {
      const logger = createLogger();
      const options = {
        storage,
        key: 'tree',
        logger,
        deserialize: () => ({
          format: 1,
          name: 'call-tree',
          at: 1,
          state: { kind: 'hierarchy', spine },
        }),
      };

      expect(loadRecord({ ...options, name: 'call-tree' })).toBeNull();
      expect(restoreHierarchyConfig(createRootConfig(), options)).toMatchObject(
        { restored: false, restoredLevels: 0, recordLevels: 0 },
      );
      expect(logger.warn).toHaveBeenCalledWith(
        MESSAGES.invalidRecord,
        expect.objectContaining({ reason: 'shape' }),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        MESSAGES.partialHierarchyRestore,
        expect.anything(),
      );
    }
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
});
