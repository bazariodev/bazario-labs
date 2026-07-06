import {
  assertRecorder,
  type InspectRecorder,
  mapSnapshotFor,
  timestampFor,
} from './inspect-recorder.js';
import { MESSAGES } from './internal/messages.js';
import {
  isFunction,
  isNonEmptyString,
  isObject,
  isRecord,
} from './internal/predicates.js';
import type {
  FsmSubscribable,
  RecordSourceOptions,
  RecordSourceSubscription,
} from './types.js';

const NO_SNAPSHOT = Symbol('no snapshot');

export function recordSource<TSnapshot>(
  source: FsmSubscribable<TSnapshot>,
  recorder: InspectRecorder,
  options: RecordSourceOptions<TSnapshot>,
): RecordSourceSubscription {
  validateSource(source);
  assertRecorder(recorder);
  if (!isRecord(options) || !isNonEmptyString(options.name)) {
    throw new Error(MESSAGES.invalidName);
  }

  let stopped = false;
  let lastRecorded: TSnapshot | typeof NO_SNAPSHOT = NO_SNAPSHOT;

  const recordSnapshot = (snapshot: TSnapshot): void => {
    if (Object.is(snapshot, lastRecorded)) return;
    if (recordCommit(snapshot, recorder, options)) lastRecorded = snapshot;
  };

  recordSnapshot(source.snapshot);

  const unsubscribe = source.subscribe((...args: [TSnapshot?]): void => {
    if (stopped) return;
    const snapshot = args.length > 0 ? (args[0] as TSnapshot) : source.snapshot;
    recordSnapshot(snapshot);
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
    },
  };
}

function recordCommit<TSnapshot>(
  snapshot: TSnapshot,
  recorder: InspectRecorder,
  options: RecordSourceOptions<TSnapshot>,
): boolean {
  const at = timestampFor(recorder);
  if (at === null) return false;

  try {
    const mappedSnapshot = mapSnapshotFor(recorder, snapshot);
    recorder.record({
      type: 'commit',
      at,
      name: options.name,
      label: options.label
        ? options.label(mappedSnapshot)
        : defaultLabel(mappedSnapshot),
      snapshot: mappedSnapshot,
    });
    return true;
  } catch {
    return false;
  }
}

function defaultLabel(snapshot: unknown): string {
  if (isObject(snapshot)) {
    if (typeof snapshot.value === 'string') return snapshot.value;
    if (typeof snapshot.path === 'string') return snapshot.path;
  }

  return 'snapshot';
}

function validateSource(
  source: unknown,
): asserts source is FsmSubscribable<unknown> {
  if (!isObject(source) || !isFunction(source.subscribe)) {
    throw new Error(MESSAGES.invalidSource);
  }
}
