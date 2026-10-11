import { Emitter } from '@bazariodev/coordination';
import { Fsm } from '@bazariodev/fsm';
import { createFsmConfig } from '../fsm-config.js';
import { RealtimeClient } from '../realtime-client.js';

export const logger = {
  debug() {},
  warn() {},
  error() {},
};

export class StubTransport {
  handlers = null;
  sent = [];
  disposed = false;
  startError = null;
  sendError = null;
  onStart = null;
  onDispose = null;
  closeEvents = 0;

  start(handlers) {
    this.handlers = handlers;
    this.onStart?.(handlers);
    if (this.startError) throw this.startError;
  }

  send(message) {
    if (this.sendError) throw this.sendError;
    this.sent.push(message);
  }

  [Symbol.dispose]() {
    this.disposed = true;
    this.onDispose?.();
  }

  open() {
    this.handlers.onOpen();
  }

  receive(message) {
    this.handlers.onMessage(message);
  }

  fail(cause = new Error('transport failed')) {
    this.handlers.onError(cause);
  }

  close(close = { clean: false }) {
    this.closeEvents++;
    this.handlers.onClose(close);
  }
}

export function createScheduler() {
  let nextHandle = 0;
  const tasks = [];
  return {
    tasks,
    setTimeout(callback, delayMs) {
      const task = { callback, delayMs, cleared: false };
      task.handle = nextHandle++;
      tasks.push(task);
      return task;
    },
    clearTimeout(task) {
      task.cleared = true;
    },
    fire(task) {
      task.cleared = true;
      task.callback();
    },
  };
}

export function createClient(options = {}) {
  const transports = [];
  const fsm = options.fsm ?? new Fsm(createFsmConfig(logger));
  const events = options.events ?? new Emitter({ logger });
  const createTransport =
    options.createTransport ??
    (() => {
      const transport = new StubTransport();
      transports.push(transport);
      return transport;
    });
  const client = new RealtimeClient({
    fsm,
    events,
    createTransport,
    retry: null,
    createKeepalive: null,
    logger,
    ...options,
  });
  return { client, events, fsm, transports };
}
