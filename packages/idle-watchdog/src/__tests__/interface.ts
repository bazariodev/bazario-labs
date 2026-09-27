import {
  IdleWatchdog,
  type IdleWatchdogLogger,
  type IdleWatchdogOptions,
  type TimeoutScheduler,
  type Unsubscribe,
} from '../index.js';

const scheduler: TimeoutScheduler = {
  setTimeout(callback, delayMs) {
    const listener: () => void = callback;
    const duration: number = delayMs;
    return { listener, duration };
  },
  clearTimeout(handle) {
    const opaque: unknown = handle;
    void opaque;
  },
};
const logger: IdleWatchdogLogger = {
  error(message, metadata) {
    const text: string = message;
    const details: unknown = metadata;
    void text;
    void details;
  },
};
const options: IdleWatchdogOptions = { idleMs: 100, scheduler, logger };
const watchdog = new IdleWatchdog(options);
const unsubscribe: Unsubscribe = watchdog.onIdle(() => {});
const armResult: void = watchdog.arm();
watchdog.cancel();
unsubscribe();
watchdog.stop();
watchdog[Symbol.dispose]();
const disposable: Disposable = watchdog;
void armResult;
void disposable;
using scoped = new IdleWatchdog({ idleMs: 100 });
scoped.arm();

// @ts-expect-error idleMs is required.
new IdleWatchdog({});
// @ts-expect-error Duration must be numeric.
new IdleWatchdog({ idleMs: '100' });
// @ts-expect-error Both scheduler operations are required.
new IdleWatchdog({ idleMs: 100, scheduler: { setTimeout() {} } });
// @ts-expect-error Idle events do not carry a payload.
watchdog.onIdle((payload: string) => void payload);
// @ts-expect-error arm does not accept per-call duration overrides.
watchdog.arm(200);
// @ts-expect-error There is no separate start lifecycle.
watchdog.start();
// @ts-expect-error Logger diagnostics use string messages.
logger.error(123);
