export function createScheduler() {
  let now = 0;
  let nextHandle = 0;
  const timers = new Map();
  const callbacks = new Map();

  return {
    setTimeout(callback, delayMs) {
      const handle = nextHandle++;
      timers.set(handle, { callback, at: now + delayMs });
      // Retain callbacks to simulate a task already queued before cancellation.
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers]
          .filter(([, { at }]) => at <= target)
          .sort(([, first], [, second]) => first.at - second.at)[0];
        if (!due) break;
        const [handle, { at, callback }] = due;
        timers.delete(handle);
        now = at;
        callback();
      }
      now = target;
    },
    fireQueued(handle) {
      callbacks.get(handle)();
    },
    pending: () => timers.size,
  };
}
