import { RpcError } from './errors.js';

/** One request's deadline, cancellation and exactly-once settlement. */
export class Operation {
  id = null;
  sent = false;
  active = true;
  #scheduler;
  #timer = null;
  #complete;
  #resolve;
  #reject;
  #onAbort;

  constructor(request, options, notification, scheduler, complete) {
    this.request = request;
    this.options = options;
    this.notification = notification;
    this.#scheduler = scheduler;
    this.#complete = complete;
    this.promise = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  watchAbort() {
    const { signal } = this.options;
    if (!signal) return;
    this.#onAbort = () =>
      this.finish(
        new RpcError('aborted', 'RPC operation aborted', signal.reason),
      );
    signal.addEventListener('abort', this.#onAbort, { once: true });
    if (signal.aborted) this.#onAbort();
  }

  arm(timeoutMs, phase) {
    this.#clearTimer();
    const timer = {};
    this.#timer = timer;
    timer.handle = this.#scheduler.setTimeout(() => {
      if (this.#timer !== timer) return;
      this.finish(new RpcError('timeout', `RPC ${phase} timed out`));
    }, timeoutMs);
  }

  finish(error, result) {
    if (!this.active) return;
    this.active = false;
    this.#clearTimer();
    if (this.#onAbort)
      this.options.signal.removeEventListener('abort', this.#onAbort);
    this.#complete(this);
    if (error) this.#reject(error);
    else this.#resolve(result);
  }

  #clearTimer() {
    const timer = this.#timer;
    this.#timer = null;
    if (timer !== null) this.#scheduler.clearTimeout(timer.handle);
  }
}
