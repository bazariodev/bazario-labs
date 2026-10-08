import { Queue } from './queue.js';

export class SyncExecutor {
  #queue = new Queue();
  #draining = false;
  #stopped = false;

  enqueue(task) {
    if (this.#stopped) throw createAbortError();
    if (typeof task !== 'function')
      throw new TypeError('task must be a function');

    this.#queue.enqueue(task);
    if (this.#draining) return;

    this.#draining = true;

    try {
      while (!this.#stopped && this.#queue.size > 0) {
        this.#queue.dequeue()();
      }
    } catch (error) {
      this.#queue.clear();
      throw error;
    } finally {
      this.#draining = false;
    }
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#queue.clear();
  }

  [Symbol.dispose]() {
    this.stop();
  }
}

function createAbortError() {
  return new DOMException('Executor is stopped', 'AbortError');
}
