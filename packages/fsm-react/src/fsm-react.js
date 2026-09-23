import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { MESSAGES } from './internal/messages.js';

const identity = (value) => value;

export function useFsmSnapshot(source) {
  return useFsmSelector(source, identity);
}

// Only a `source` change resubscribes. `getSelection` is rebuilt each render,
// so it always reads the current selector and comparator. The cache is keyed
// on all three inputs: a selection `isEqual` accepted may come from an older
// snapshot, so a new comparator must recompute it.
export function useFsmSelector(source, selector, isEqual = Object.is) {
  const cache = useRef(null);
  const subscribe = useCallback(
    (onStoreChange) => source.subscribe(onStoreChange),
    [source],
  );

  const getSelection = () => {
    const snapshot = source.snapshot;
    const last = cache.current;
    if (
      last !== null &&
      Object.is(last.snapshot, snapshot) &&
      last.selector === selector &&
      last.isEqual === isEqual
    ) {
      return last.selection;
    }
    const next = selector(snapshot);
    const selection =
      last !== null && isEqual(last.selection, next) ? last.selection : next;
    cache.current = { snapshot, selector, isEqual, selection };
    return selection;
  };

  return useSyncExternalStore(subscribe, getSelection, getSelection);
}

export function useFsm(create, options = {}) {
  // Read at effect time, so new callback identities never restart the lifecycle.
  const latest = useRef(null);
  // The machine this hook last tore down; it is never attached again.
  const dead = useRef(null);

  const [machine, setMachine] = useState(create);
  const snapshot = useFsmSnapshot(machine);

  // Synced on commit, not during render, so a render React discards (such as
  // a suspended transition) cannot replace the committed callbacks. Declared
  // before the ownership effect, so its setup always sees them.
  useEffect(() => {
    latest.current = { create, options };
  });

  useEffect(() => {
    // StrictMode replays setup after cleanup on the same component instance:
    // once teardown has run, swap in a fresh machine instead of reattaching.
    if (dead.current === machine) {
      const fresh = latest.current.create();
      // The same machine would not re-render, leaving a dead machine mounted.
      if (fresh === machine) throw new Error(MESSAGES.deadMachineReturned);
      // An updater, so a callable machine is stored rather than called.
      setMachine(() => fresh);
      return;
    }

    const cleanup = latest.current.options.attach?.(machine);
    return () => {
      try {
        cleanup?.();
      } finally {
        const { teardown } = latest.current.options;
        if (teardown) {
          dead.current = machine;
          teardown(machine);
        }
      }
    };
  }, [machine]);

  return { machine, snapshot };
}
