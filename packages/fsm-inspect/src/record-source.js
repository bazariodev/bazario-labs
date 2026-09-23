import { assertRecorder, capture } from './inspect-recorder.js';

/** Records a `commit` entry for the attach-time snapshot, then for each delivered one. */
export function recordSource(source, recorder, options) {
  assertRecorder(recorder);
  const { name } = options;
  let last = source.snapshot;
  let stopped = false;

  const record = (snapshot) => {
    capture(recorder, (at, { mapSnapshot }) => {
      const mapped = mapSnapshot(snapshot);
      const label = options.label
        ? options.label(mapped)
        : defaultLabel(mapped);
      return { type: 'commit', at, name, label, snapshot: mapped };
    });
  };

  record(last);

  // A payload is the snapshot the source announced; without one, read the
  // source. Genuine commits are fresh references, so the reference check only
  // skips a redelivery, such as a node handle's birth snapshot right after the
  // attach-time capture.
  const unsubscribe = source.subscribe((payload) => {
    if (stopped) return;
    const snapshot = payload === undefined ? source.snapshot : payload;
    if (Object.is(snapshot, last)) return;
    last = snapshot;
    record(snapshot);
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
    },
  };
}

// Core snapshots carry a string `value`, hierarchy snapshots a string `path`.
function defaultLabel(snapshot) {
  const { value, path } = snapshot ?? {};
  if (typeof value === 'string') return value;
  return typeof path === 'string' ? path : 'snapshot';
}
