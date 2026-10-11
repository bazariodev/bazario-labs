import type { TimeoutScheduler } from '@bazariodev/idle-watchdog';
import type {
  KeepaliveFailure,
  KeepaliveLogger,
  KeepaliveOptions,
  KeepaliveProbe,
  KeepaliveScheduler,
} from '../index.js';
import { Keepalive } from '../index.js';

const probe: KeepaliveProbe = async (signal) => {
  const aborted: boolean = signal.aborted;
  void aborted;
};

const scheduler: TimeoutScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
const keepaliveScheduler: KeepaliveScheduler = scheduler;
const timeoutScheduler: TimeoutScheduler = keepaliveScheduler;

const logger: KeepaliveLogger = {
  error(message, metadata) {
    void [message, metadata];
  },
};

const options: KeepaliveOptions = {
  probe,
  idleMs: 1000,
  deadlineMs: 500,
  scheduler: keepaliveScheduler,
  logger,
};

const keepalive = new Keepalive(options);
keepalive.start();
keepalive.activity();
keepalive.probeNow();
const unsubscribe = keepalive.onFail((failure: KeepaliveFailure) => {
  if (failure.type === 'error') void failure.error;
});
unsubscribe();
keepalive.stop();
keepalive[Symbol.dispose]();

// @ts-expect-error A probe is required.
new Keepalive({ idleMs: 1000, deadlineMs: 500 });
// @ts-expect-error A probe receives an AbortSignal.
const invalidProbe: KeepaliveProbe = async (_signal: string) => {};
// @ts-expect-error idleMs must be a number or duration function.
new Keepalive({ probe, idleMs: '1000', deadlineMs: 500 });
// @ts-expect-error deadlineMs must be a fixed duration.
new Keepalive({ probe, idleMs: 1000, deadlineMs: () => 500 });
// @ts-expect-error The probe must return a promise.
const invalidResult: KeepaliveProbe = () => {};
void [invalidProbe, invalidResult, timeoutScheduler];
