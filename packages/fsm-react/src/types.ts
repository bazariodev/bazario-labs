import type { FsmSubscribable } from '@bazariodev/fsm';

export type { FsmSubscribable } from '@bazariodev/fsm';

export type EqualityFn<T> = (a: T, b: T) => boolean;

export type UseFsmOptions<TMachine> = Readonly<{
  attach?: (machine: TMachine) => void | (() => void);
  teardown?: (machine: TMachine) => void;
}>;

export type SnapshotOf<TMachine> =
  TMachine extends FsmSubscribable<infer S> ? S : never;
