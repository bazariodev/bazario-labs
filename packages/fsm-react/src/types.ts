import type { Unsubscribe } from '@bazariodev/fsm';

export type FsmSubscribable<TSnapshot> = Readonly<{
  snapshot: TSnapshot;
  subscribe: (listener: (snapshot: TSnapshot) => void) => Unsubscribe;
}>;

export type EqualityFn<T> = (a: T, b: T) => boolean;

export type UseFsmOptions<TMachine> = Readonly<{
  attach?: (machine: TMachine) => void | (() => void);
  teardown?: (machine: TMachine) => void;
}>;

export type SnapshotOf<TMachine> =
  TMachine extends FsmSubscribable<infer S> ? S : never;
