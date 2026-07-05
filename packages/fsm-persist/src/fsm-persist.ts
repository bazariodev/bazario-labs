import type { FsmSnapshot } from '@bazariodev/fsm';

import { MESSAGES } from './internal/messages.js';
import {
  isFunction,
  isNonEmptyString,
  isPersistStorage,
  NOOP_LOGGER,
} from './internal/predicates.js';
import type {
  FsmSubscribable,
  HierarchyNodeSnapshotLike,
  HierarchySnapshotLike,
  PersistedFsmState,
  PersistedHierarchyState,
  PersistedState,
  PersistOptions,
  PersistRecord,
} from './types.js';

const defaultSerialize = (record: PersistRecord): string =>
  JSON.stringify(record);

const defaultNow = (): number => Date.now();
const MAX_HIERARCHY_SPINE_DEPTH = 1_000;

export function persistFsm<TState extends string, TContext>(
  source: FsmSubscribable<FsmSnapshot<TState, TContext>>,
  options: PersistOptions<FsmSnapshot<TState, TContext>>,
): FsmPersist<FsmSnapshot<TState, TContext>> {
  return new FsmPersist(source, snapshotToPersistedFsmState, options);
}

export function persistHierarchy(
  source: FsmSubscribable<HierarchySnapshotLike>,
  options: PersistOptions<HierarchySnapshotLike>,
): FsmPersist<HierarchySnapshotLike> {
  return new FsmPersist(source, snapshotToPersistedHierarchyState, options);
}

export class FsmPersist<TSnapshot> {
  readonly #source: FsmSubscribable<TSnapshot>;
  readonly #toState: (snapshot: TSnapshot) => PersistedState;
  readonly #storage: PersistOptions<TSnapshot>['storage'];
  readonly #key: string;
  readonly #name: string;
  readonly #filter?: (snapshot: TSnapshot) => boolean;
  readonly #serialize: (record: PersistRecord) => string;
  readonly #logger: NonNullable<PersistOptions<TSnapshot>['logger']>;
  readonly #now: () => number;

  #stopped = false;
  #unsubscribe: (() => void) | null = null;
  #lastWrittenSnapshot: TSnapshot | null = null;

  constructor(
    source: FsmSubscribable<TSnapshot>,
    toState: (snapshot: TSnapshot) => PersistedState,
    options: PersistOptions<TSnapshot>,
  ) {
    validateSource(source);
    if (!isFunction(toState)) throw new Error(MESSAGES.invalidToState);
    validatePersistOptions(options);

    this.#source = source;
    this.#toState = toState;
    this.#storage = options.storage;
    this.#key = options.key;
    this.#name = options.name;
    this.#filter = options.filter;
    this.#serialize = options.serialize ?? defaultSerialize;
    this.#logger = options.logger ?? NOOP_LOGGER;
    this.#now = options.now ?? defaultNow;

    this.#unsubscribe = source.subscribe(() => this.#writeCurrent());
    this.#writeCurrent();
  }

  clear(): void {
    try {
      this.#storage.removeItem(this.#key);
    } catch (error) {
      this.#logger.error(MESSAGES.clearFailed, {
        key: this.#key,
        name: this.#name,
        error,
      });
    }
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  [Symbol.dispose](): void {
    this.stop();
  }

  #writeCurrent(): void {
    if (this.#stopped) return;

    try {
      const snapshot = this.#source.snapshot;
      if (Object.is(snapshot, this.#lastWrittenSnapshot)) return;
      if (this.#filter && !this.#filter(snapshot)) return;

      const state = this.#toState(snapshot);
      const at = this.#now();
      if (!Number.isFinite(at)) {
        throw new Error('now returned a non-finite timestamp');
      }

      const record: PersistRecord = {
        format: 1,
        name: this.#name,
        at,
        state,
      };
      const serialized = this.#serialize(record);
      if (typeof serialized !== 'string') {
        throw new Error('serialize returned a non-string value');
      }

      this.#storage.setItem(this.#key, serialized);
      this.#lastWrittenSnapshot = snapshot;
    } catch (error) {
      this.#logger.error(MESSAGES.writeFailed, {
        key: this.#key,
        name: this.#name,
        error,
      });
    }
  }
}

function validateSource(
  source: unknown,
): asserts source is FsmSubscribable<unknown> {
  if (
    typeof source !== 'object' ||
    source === null ||
    !isFunction((source as { subscribe?: unknown }).subscribe)
  ) {
    throw new Error(MESSAGES.invalidSource);
  }
}

function snapshotToPersistedFsmState<TState extends string, TContext>(
  snapshot: FsmSnapshot<TState, TContext>,
): PersistedFsmState {
  return {
    kind: 'fsm',
    value: snapshot.value,
    context: snapshot.context,
  };
}

function snapshotToPersistedHierarchyState(
  snapshot: HierarchySnapshotLike,
): PersistedHierarchyState {
  const spine: Array<{ value: string; context: unknown }> = [];
  const seen = new Set<HierarchyNodeSnapshotLike>();

  for (
    let node: HierarchyNodeSnapshotLike | null = snapshot.root;
    node;
    node = node.child
  ) {
    if (seen.has(node)) throw new Error('hierarchy snapshot contains a cycle');
    if (spine.length >= MAX_HIERARCHY_SPINE_DEPTH) {
      throw new Error('hierarchy snapshot exceeds maximum persisted depth');
    }

    seen.add(node);
    spine.push({ value: node.value, context: node.context });
  }

  return { kind: 'hierarchy', spine };
}

function validatePersistOptions<TSnapshot>(
  options: PersistOptions<TSnapshot>,
): void {
  if (!isPersistStorage(options.storage))
    throw new Error(MESSAGES.invalidStorage);
  if (!isNonEmptyString(options.key)) throw new Error(MESSAGES.invalidKey);
  if (!isNonEmptyString(options.name)) throw new Error(MESSAGES.invalidName);
  if (options.filter !== undefined && !isFunction(options.filter)) {
    throw new Error(MESSAGES.invalidFilter);
  }
  if (options.serialize !== undefined && !isFunction(options.serialize)) {
    throw new Error(MESSAGES.invalidSerialize);
  }
  if (options.now !== undefined && !isFunction(options.now)) {
    throw new Error(MESSAGES.invalidNow);
  }
}
