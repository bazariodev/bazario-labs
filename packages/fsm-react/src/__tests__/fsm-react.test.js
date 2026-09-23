import { Fsm } from '@bazariodev/fsm';
import { FsmHierarchy } from '@bazariodev/fsm-hierarchy';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  createElement,
  StrictMode,
  Suspense,
  startTransition,
  use,
  useState,
} from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useFsm, useFsmSelector, useFsmSnapshot } from '../index.js';
import { MESSAGES } from '../internal/messages.js';

const createMachine = (
  context = { count: 0, label: 'initial' },
  initial = 'idle',
) =>
  new Fsm({
    name: 'react-test',
    initial,
    context,
    states: {
      idle: {},
      active: {},
    },
    transitions: {
      idle: {
        GO: { target: 'active' },
        INC: {
          target: 'idle',
          reducer: (current) => ({
            ...current,
            count: current.count + 1,
          }),
        },
        LABEL: {
          target: 'idle',
          reducer: (current, event) => ({
            ...current,
            label: event.type === 'LABEL' ? event.label : current.label,
          }),
        },
      },
      active: {
        RESET: { target: 'idle' },
        INC: {
          target: 'active',
          reducer: (current) => ({
            ...current,
            count: current.count + 1,
          }),
        },
        LABEL: {
          target: 'active',
          reducer: (current, event) => ({
            ...current,
            label: event.type === 'LABEL' ? event.label : current.label,
          }),
        },
      },
      '*': {},
    },
  });

const createHierarchy = () =>
  new FsmHierarchy({
    name: 'call',
    initial: 'idle',
    context: {},
    states: {
      idle: {},
      connected: {},
    },
    transitions: {
      idle: {
        CONNECT: { target: 'connected' },
      },
      connected: {},
      '*': {},
    },
    children: {
      connected: {
        name: 'connected-flow',
        initial: 'active',
        context: {},
        states: {
          active: {},
          muted: {},
        },
        transitions: {
          active: {
            MUTE: { target: 'muted' },
          },
          muted: {},
          '*': {},
        },
      },
    },
  });

class TestSource {
  #subscribers = new Set();
  #snapshot;

  stopped = false;

  constructor(id) {
    this.id = id;
    this.#snapshot = Object.freeze({ id });
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (this.stopped) return () => undefined;
    this.#subscribers.add(listener);
    return () => {
      this.#subscribers.delete(listener);
    };
  }

  stop() {
    this.stopped = true;
    this.#subscribers.clear();
  }
}

const countedSource = (source) => {
  let subscriptions = 0;
  let unsubscriptions = 0;

  return {
    get snapshot() {
      return source.snapshot;
    },
    subscribe(listener) {
      subscriptions += 1;
      const unsubscribe = source.subscribe(listener);
      return () => {
        unsubscriptions += 1;
        unsubscribe();
      };
    },
    subscriptions: () => subscriptions,
    unsubscriptions: () => unsubscriptions,
  };
};

const selectCount = (snapshot) => snapshot.context.count;

describe('fsm-react bindings', () => {
  it('updates whole snapshots only for committed transitions', () => {
    const machine = createMachine();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useFsmSnapshot(machine);
    });

    expect(result.current.value).toBe('idle');
    expect(result.current.version).toBe(0);

    act(() => machine.send({ type: 'NOOP' }));

    expect(renders).toBe(1);
    expect(result.current.version).toBe(0);

    act(() => machine.send({ type: 'GO' }));

    expect(renders).toBe(2);
    expect(result.current.value).toBe('active');
    expect(result.current.version).toBe(1);
  });

  it('keeps selector renders and references stable when equality passes', () => {
    const machine = createMachine();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useFsmSelector(
        machine,
        (snapshot) => ({ count: snapshot.context.count }),
        (a, b) => a.count === b.count,
      );
    });
    const initialSelection = result.current;

    act(() => machine.send({ type: 'LABEL', label: 'changed' }));

    expect(renders).toBe(1);
    expect(result.current).toBe(initialSelection);

    act(() => machine.send({ type: 'INC' }));

    expect(renders).toBe(2);
    expect(result.current).toEqual({ count: 1 });
    expect(result.current).not.toBe(initialSelection);
  });

  it('recomputes when isEqual changes after a coarse comparator kept an older selection', () => {
    const machine = createMachine();
    const coarse = () => true;
    const { result, rerender } = renderHook(
      ({ isEqual }) => useFsmSelector(machine, selectCount, isEqual),
      { initialProps: { isEqual: coarse } },
    );

    act(() => machine.send({ type: 'INC' }));
    expect(result.current).toBe(0);

    rerender({ isEqual: Object.is });

    expect(result.current).toBe(1);
  });

  it('reads primitive snapshots, including undefined and a -0 to +0 change', () => {
    const primitiveSource = (initial) => {
      const listeners = new Set();
      return {
        snapshot: initial,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        commit(next) {
          this.snapshot = next;
          for (const listener of listeners) listener();
        },
      };
    };

    const empty = primitiveSource(undefined);
    expect(renderHook(() => useFsmSnapshot(empty)).result.current).toBe(
      undefined,
    );
    expect(
      renderHook(() => useFsmSelector(empty, (value) => value ?? 'none')).result
        .current,
    ).toBe('none');

    const zero = primitiveSource(-0);
    const { result } = renderHook(() => useFsmSnapshot(zero));
    expect(Object.is(result.current, -0)).toBe(true);

    act(() => zero.commit(0));

    expect(Object.is(result.current, 0)).toBe(true);
  });

  it('recomputes when selector identity changes without resubscribing', () => {
    const machine = createMachine({ count: 7, label: 'seven' });
    const source = countedSource(machine);
    const { result, rerender } = renderHook(
      ({ field }) =>
        useFsmSelector(source, (snapshot) => snapshot.context[field]),
      {
        initialProps: { field: 'count' },
      },
    );

    expect(result.current).toBe(7);
    expect(source.subscriptions()).toBe(1);

    rerender({ field: 'label' });

    expect(result.current).toBe('seven');
    expect(source.subscriptions()).toBe(1);
    expect(source.unsubscriptions()).toBe(0);
  });

  it('resubscribes and synchronously reads when the source identity changes', () => {
    const first = countedSource(createMachine({ count: 1, label: 'one' }));
    const second = countedSource(createMachine({ count: 2, label: 'two' }));
    const { result, rerender } = renderHook(
      ({ source }) =>
        useFsmSelector(source, (snapshot) => snapshot.context.count),
      {
        initialProps: { source: first },
      },
    );

    expect(result.current).toBe(1);
    expect(first.subscriptions()).toBe(1);

    rerender({ source: second });

    expect(result.current).toBe(2);
    expect(first.unsubscriptions()).toBe(1);
    expect(second.subscriptions()).toBe(1);
  });

  it('binds FsmHierarchy and hierarchy node handles as structural sources', () => {
    const hierarchy = createHierarchy();
    const hierarchyHook = renderHook(() =>
      useFsmSelector(hierarchy, (snapshot) => snapshot.path),
    );

    expect(hierarchyHook.result.current).toBe('idle');

    act(() => hierarchy.send({ type: 'CONNECT' }));

    expect(hierarchyHook.result.current).toBe('connected.active');

    const node = hierarchy.nodeFor('connected.active');
    if (!node) throw new Error('expected connected.active node');

    const nodeHook = renderHook(() => useFsmSnapshot(node));

    expect(nodeHook.result.current.value).toBe('active');

    act(() => hierarchy.send({ type: 'MUTE' }));

    expect(hierarchyHook.result.current).toBe('connected.muted');
    expect(nodeHook.result.current.value).toBe('muted');
  });

  it('renders the initial snapshot during server rendering', () => {
    const machine = createMachine();

    function View() {
      const state = useFsmSelector(machine, (snapshot) => snapshot.value);
      return createElement('span', null, state);
    }

    expect(renderToString(createElement(View))).toContain('idle');
  });

  it('keeps the same machine through StrictMode effect replay without teardown', () => {
    let nextId = 0;
    const createSource = () => {
      nextId += 1;
      return new TestSource(nextId);
    };
    const create = vi.fn(createSource);
    const attached = [];
    const cleaned = [];

    renderHook(
      () =>
        useFsm(create, {
          attach: (source) => {
            attached.push(source.id);
            return () => cleaned.push(source.id);
          },
        }),
      {
        wrapper: StrictMode,
      },
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(attached.length).toBeGreaterThanOrEqual(2);
    expect(new Set(attached).size).toBe(1);
    expect(cleaned).toEqual([attached[0]]);
  });

  it('re-creates after teardown and never attaches to a stopped machine', async () => {
    let nextId = 0;
    const createSource = () => {
      nextId += 1;
      return new TestSource(nextId);
    };
    const create = vi.fn(createSource);
    const attached = [];
    const tornDown = [];
    const { result } = renderHook(
      () =>
        useFsm(create, {
          attach: (source) => {
            attached.push({ id: source.id, stopped: source.stopped });
          },
          teardown: (source) => {
            tornDown.push(source.id);
            source.stop();
          },
        }),
      {
        wrapper: StrictMode,
      },
    );

    await waitFor(() => expect(attached.length).toBeGreaterThanOrEqual(2));

    expect(create).toHaveBeenCalledTimes(3);
    expect(tornDown.length).toBeGreaterThanOrEqual(1);
    expect(attached.every((entry) => !entry.stopped)).toBe(true);
    expect(result.current.machine.stopped).toBe(false);
    expect(attached.at(-1)?.id).toBe(result.current.machine.id);
  });

  it('throws if create returns a machine that was already torn down', () => {
    const sharedSource = new TestSource(1);
    const create = vi.fn(() => sharedSource);

    expect(() => {
      renderHook(
        () =>
          useFsm(create, {
            teardown: (source) => source.stop(),
          }),
        {
          wrapper: StrictMode,
        },
      );
    }).toThrow(MESSAGES.deadMachineReturned);
  });

  it('runs attach cleanup before teardown on unmount', () => {
    let nextId = 0;
    const createSource = () => {
      nextId += 1;
      return new TestSource(nextId);
    };
    const events = [];
    const { unmount } = renderHook(() =>
      useFsm(createSource, {
        attach: (source) => {
          events.push(`attach:${source.id}`);
          return () => events.push(`cleanup:${source.id}`);
        },
        teardown: (source) => {
          events.push(`teardown:${source.id}`);
          source.stop();
        },
      }),
    );

    unmount();

    expect(events).toEqual(['attach:1', 'cleanup:1', 'teardown:1']);
  });

  it('runs teardown and marks dead when attach cleanup throws', () => {
    let nextId = 0;
    const createSource = () => {
      nextId += 1;
      return new TestSource(nextId);
    };
    const cleanupError = new Error('cleanup failed');
    const tornDown = [];
    const { unmount } = renderHook(() =>
      useFsm(createSource, {
        attach: () => {
          return () => {
            throw cleanupError;
          };
        },
        teardown: (source) => {
          tornDown.push(source);
          source.stop();
        },
      }),
    );

    expect(() => unmount()).toThrow(cleanupError);
    expect(tornDown).toHaveLength(1);
    expect(tornDown[0]?.stopped).toBe(true);
  });

  it('tears down with the committed callbacks when a later render suspends', () => {
    const teardown = vi.fn();
    const pending = new Promise(() => undefined);
    let setSuspended = null;

    function Owner() {
      const [suspended, setState] = useState(false);
      setSuspended = setState;
      // The suspended render drops teardown, but it is never committed.
      useFsm(() => new TestSource(1), suspended ? {} : { teardown });
      if (suspended) use(pending);
      return null;
    }

    const { unmount } = render(
      createElement(Suspense, { fallback: null }, createElement(Owner)),
    );
    act(() => startTransition(() => setSuspended(true)));

    unmount();

    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('keeps the lifecycle when attach and teardown identities change', () => {
    const attach = vi.fn();
    const teardown = vi.fn();
    const { rerender, unmount } = renderHook(() =>
      useFsm(() => new TestSource(1), {
        attach: (source) => attach(source),
        teardown: (source) => teardown(source),
      }),
    );

    rerender();
    rerender();

    expect(attach).toHaveBeenCalledTimes(1);
    expect(teardown).not.toHaveBeenCalled();

    unmount();

    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('observes sends performed by attach-installed effects', async () => {
    const { result } = renderHook(() =>
      useFsm(() => createMachine(), {
        attach: (machine) => {
          machine.send({ type: 'GO' });
        },
      }),
    );

    await waitFor(() => expect(result.current.snapshot.value).toBe('active'));
  });
});
