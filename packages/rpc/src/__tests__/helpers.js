import { vi } from 'vitest';

export function createChannel(state = 'ready') {
  const messages = new Set();
  const states = new Set();
  return {
    state,
    sent: [],
    send: vi.fn(function (message) {
      this.sent.push(message);
      return true;
    }),
    onMessage(listener) {
      messages.add(listener);
      return () => messages.delete(listener);
    },
    subscribe(listener) {
      states.add(listener);
      return () => states.delete(listener);
    },
    receive(message) {
      for (const listener of [...messages]) listener(message);
    },
    transition(value) {
      this.state = value;
      const snapshot = Object.freeze({ value });
      for (const listener of [...states]) listener(snapshot);
    },
    get subscriptions() {
      return messages.size + states.size;
    },
  };
}
