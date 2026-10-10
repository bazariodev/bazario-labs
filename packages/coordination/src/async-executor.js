import { Queue } from './queue.js';

export class AsyncExecutor {
  #queue = new Queue();
  #running = false;
  #activeController;
  #stopReason;

  enqueue(task) {
    if (this.#stopReason) return Promise.reject(this.#stopReason);
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('task must be a function'));
    }

    let resolve;
    let reject;
    const result = new Promise((fulfill, fail) => {
      resolve = fulfill;
      reject = fail;
    });

    this.#queue.enqueue({ task, resolve, reject });
    if (!this.#running) {
      this.#running = true;
      Promise.resolve().then(() => this.#run());
    }
    return result;
  }

  stop() {
    if (this.#stopReason) return;
    this.#stopReason = createAbortError();
    const active = this.#activeController;
    this.#activeController = undefined;
    active?.abort(this.#stopReason);
    while (this.#queue.size > 0) this.#queue.dequeue().reject(this.#stopReason);
  }

  [Symbol.dispose]() {
    this.stop();
  }

  async #run() {
    while (this.#queue.size > 0) {
      const { task, resolve, reject } = this.#queue.dequeue();
      const controller = new AbortController();
      this.#activeController = controller;

      let settle = resolve;
      let outcome;
      try {
        outcome = await task(controller.signal);
      } catch (error) {
        settle = reject;
        outcome = error;
      }

      this.#activeController = undefined;
      settle(outcome);
    }
    this.#running = false;
  }
}

function createAbortError() {
  return new DOMException('Executor is stopped', 'AbortError');
}
