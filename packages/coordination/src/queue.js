export class Queue {
  #items = [];
  #head = 0;

  get size() {
    return this.#items.length - this.#head;
  }

  enqueue(value) {
    this.#items.push(value);
  }

  dequeue() {
    if (this.size === 0) return undefined;

    const value = this.#items[this.#head];
    this.#items[this.#head] = undefined;
    this.#head += 1;

    if (this.#head === this.#items.length) {
      this.#items = [];
      this.#head = 0;
    } else if (this.#head > 64 && this.#head * 2 >= this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }

    return value;
  }

  peek() {
    return this.size === 0 ? undefined : this.#items[this.#head];
  }

  clear() {
    this.#items = [];
    this.#head = 0;
  }
}
