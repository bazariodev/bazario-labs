import {
  Keepalive,
  type KeepaliveFailure,
  type KeepaliveLogger,
  type KeepaliveOptions,
  type KeepaliveProbe,
  type KeepaliveScheduler,
  type Unsubscribe,
} from '../index.js';

const probe: KeepaliveProbe = async (signal) => {
  const typed: AbortSignal = signal;
  typed.throwIfAborted();
};
const scheduler: KeepaliveScheduler = {
  setTimeout(callback, delayMs) {
    return { callback, delayMs };
  },
  clearTimeout(handle) {
    const opaque: unknown = handle;
    void opaque;
  },
};
const logger: KeepaliveLogger = {
  error(message, metadata) {
    const text: string = message;
    const details: unknown = metadata;
    void text;
    void details;
  },
};
const options: KeepaliveOptions = {
  idleMs: 1000,
  deadlineMs: 100,
  probe,
  scheduler,
  logger,
};
const keepalive = new Keepalive(options);
const unsubscribe: Unsubscribe = keepalive.onFail((failure) => {
  const typed: KeepaliveFailure = failure;
  void typed;
  switch (failure.type) {
    case 'timeout': {
      break;
    }
    case 'error': {
      const error: unknown = failure.error;
      void error;
      break;
    }
    default: {
      const exhaustive: never = failure;
      void exhaustive;
    }
  }
});
const startResult: void = keepalive.start();
const activityResult: void = keepalive.activity();
const probeResult: void = keepalive.probeNow();
unsubscribe();
keepalive.stop();
keepalive[Symbol.dispose]();
const disposable: Disposable = keepalive;
void startResult;
void activityResult;
void probeResult;
void disposable;
using scoped = new Keepalive(options);
scoped.start();

// @ts-expect-error idleMs is required.
new Keepalive({ deadlineMs: 100, probe });
// @ts-expect-error deadlineMs is required.
new Keepalive({ idleMs: 1000, probe });
// @ts-expect-error probe is required.
new Keepalive({ idleMs: 1000, deadlineMs: 100 });
// @ts-expect-error Durations are numeric.
new Keepalive({ ...options, idleMs: '100' });
// @ts-expect-error Each invocation must create an operation, not reuse an injected promise.
new Keepalive({ ...options, probe: Promise.resolve() });
// @ts-expect-error The probe must return a promise.
new Keepalive({ ...options, probe: () => {} });
// @ts-expect-error Fulfillment means validated liveness; boolean results are not a success flag.
new Keepalive({ ...options, probe: async () => false });
// @ts-expect-error Both scheduler methods are required.
new Keepalive({ ...options, scheduler: { setTimeout() {} } });
