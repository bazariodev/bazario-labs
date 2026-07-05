import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { EqualityFn, FsmSubscribable } from './types.js';

type SelectionCache<TSnapshot, TSelected> = Readonly<{
  snapshot: TSnapshot;
  selector: (snapshot: TSnapshot) => TSelected;
  isEqual: EqualityFn<TSelected>;
  selection: TSelected;
}>;

export function useFsmSelector<TSnapshot, TSelected>(
  source: FsmSubscribable<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  isEqual: EqualityFn<TSelected> = Object.is,
): TSelected {
  const selectorRef = useRef(selector);
  const isEqualRef = useRef(isEqual);
  const cacheRef = useRef<SelectionCache<TSnapshot, TSelected> | null>(null);

  selectorRef.current = selector;
  isEqualRef.current = isEqual;

  const subscribe = useCallback(
    (onStoreChange: () => void) => source.subscribe(onStoreChange),
    [source],
  );
  const getSnapshot = useCallback(() => {
    const snapshot = source.snapshot;
    const currentSelector = selectorRef.current;
    const currentIsEqual = isEqualRef.current;
    const cache = cacheRef.current;

    if (
      cache &&
      cache.snapshot === snapshot &&
      cache.selector === currentSelector &&
      cache.isEqual === currentIsEqual
    ) {
      return cache.selection;
    }

    const nextSelection = currentSelector(snapshot);
    const selection =
      cache && currentIsEqual(cache.selection, nextSelection)
        ? cache.selection
        : nextSelection;

    cacheRef.current = {
      snapshot,
      selector: currentSelector,
      isEqual: currentIsEqual,
      selection,
    };

    return selection;
  }, [source]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
