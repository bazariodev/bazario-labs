import type { FsmSubscribable } from '@bazariodev/fsm';

export type { FsmSubscribable };

export type EqualityFn<T> = (a: T, b: T) => boolean;

export type UseFsmOptions<TMachine> = Readonly<{
  /** Runs after mount against a live machine; the returned cleanup runs before `teardown`. */
  attach?: (machine: TMachine) => void | (() => void);
  /** Ends the machine's life; afterwards the hook re-creates instead of reattaching. */
  teardown?: (machine: TMachine) => void;
}>;

export type SnapshotOf<TMachine> =
  TMachine extends FsmSubscribable<infer S> ? S : never;

/** The source's current snapshot, re-rendering on each committed change. */
export declare function useFsmSnapshot<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
): TSnapshot;

/**
 * A derived slice that re-renders only when `isEqual` (default `Object.is`) fails;
 * the previous selection reference is kept while it passes. `selector` must be pure.
 */
export declare function useFsmSelector<TSnapshot, TSelected>(
  source: FsmSubscribable<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  isEqual?: EqualityFn<TSelected>,
): TSelected;

/**
 * A component-owned machine. `create` runs in a lazy state initializer and must be
 * discard-safe; throws if `create` returns the machine it just tore down.
 */
export declare function useFsm<TMachine extends FsmSubscribable<unknown>>(
  create: () => TMachine,
  options?: UseFsmOptions<TMachine>,
): Readonly<{ machine: TMachine; snapshot: SnapshotOf<TMachine> }>;
