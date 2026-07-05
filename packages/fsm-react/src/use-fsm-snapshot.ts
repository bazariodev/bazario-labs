import { useCallback, useSyncExternalStore } from 'react';

import type { FsmSubscribable } from './types.js';

export function useFsmSnapshot<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
): TSnapshot {
  const subscribe = useCallback(
    (onStoreChange: () => void) => source.subscribe(onStoreChange),
    [source],
  );
  const getSnapshot = useCallback(() => source.snapshot, [source]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
