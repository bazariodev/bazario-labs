import { describe, expect, it, vi } from 'vitest';

import { Queue } from '../index.js';

describe('Queue', () => {
  it('stores values in FIFO order without executing them', () => {
    const queue = new Queue();
    const task = vi.fn(() => 'untouched');

    queue.enqueue(task);
    queue.enqueue(2);

    expect(queue.size).toBe(2);
    expect(queue.peek()).toBe(task);
    expect(queue.dequeue()).toBe(task);
    expect(queue.dequeue()).toBe(2);
    expect(task).not.toHaveBeenCalled();
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.peek()).toBeUndefined();
  });

  it('distinguishes a stored undefined through size and can be cleared and reused', () => {
    const queue = new Queue();

    queue.enqueue(undefined);
    expect(queue.size).toBe(1);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.size).toBe(0);

    queue.enqueue('old');
    queue.clear();
    expect(queue.size).toBe(0);
    queue.enqueue('new');
    expect(queue.dequeue()).toBe('new');
  });

  it('preserves FIFO while compacting after a long drain', () => {
    const queue = new Queue();
    for (let value = 0; value < 200; value += 1) queue.enqueue(value);
    for (let value = 0; value < 150; value += 1)
      expect(queue.dequeue()).toBe(value);
    for (let value = 200; value < 260; value += 1) queue.enqueue(value);
    for (let value = 150; value < 260; value += 1)
      expect(queue.dequeue()).toBe(value);
    expect(queue.size).toBe(0);
  });
});
