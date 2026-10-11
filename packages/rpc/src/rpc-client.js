import { Emitter } from '@bazariodev/coordination';
import { RpcError, RpcResponseError } from './errors.js';
import {
  assertDuration,
  assertRequest,
  assertRequestOptions,
  hasId,
  isErrorData,
  isNotification,
  isResponse,
} from './guards.js';
import { Operation } from './operation.js';
import { normalizeOptions } from './options.js';

export class RpcClient {
  #options;
  #channel;
  #events;
  #operations = new Set();
  #pending = new Map();
  #unsubscribe;
  #unsubscribeState;
  #stopped = false;

  constructor(options) {
    this.#options = normalizeOptions(options);
    this.#channel = this.#options.channel;
    this.#events = new Emitter({ logger: this.#options.logger });
    this.#unsubscribe = this.#channel.onMessage((message) =>
      this.#receive(message),
    );
    try {
      this.#unsubscribeState = this.#channel.subscribe((snapshot) =>
        this.#onState(snapshot.value),
      );
    } catch (error) {
      this.#unsubscribe();
      throw error;
    }
    if (this.#channel.state === 'stopped') this.stop();
  }

  get pendingCount() {
    return this.#operations.size;
  }
  request(request, options = {}) {
    return this.#submit(request, options, false);
  }
  notify(notification, options = {}) {
    return this.#submit(notification, options, true);
  }
  onNotification(listener) {
    return this.#events.on('notification', listener);
  }

  async probe(request, options = {}) {
    try {
      await this.request(request, options);
    } catch (error) {
      if (!(error instanceof RpcResponseError)) throw error;
    }
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#unsubscribe();
    this.#unsubscribeState();
    this.#events.stop();
    for (const operation of [...this.#operations])
      operation.finish(new RpcError('stopped', 'RPC client stopped'));
  }
  [Symbol.dispose]() {
    this.stop();
  }

  #submit(request, options, notification) {
    let operation;
    try {
      if (this.#stopped || this.#channel.state === 'stopped')
        throw new RpcError('stopped', 'RPC client stopped');
      if (this.pendingCount >= this.#options.maxPending)
        throw new RpcError('capacity', 'RPC capacity reached');
      assertRequest(request);
      const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;
      assertDuration(timeoutMs);
      assertRequestOptions(options);
      const { method, params } = request;
      const { signal, onWillSend } = options;
      const data = { method, ...(params === undefined ? {} : { params }) };
      operation = new Operation(
        data,
        { signal, onWillSend, timeoutMs },
        notification,
        this.#options.scheduler,
        (settled) => {
          this.#operations.delete(settled);
          if (this.#pending.get(settled.id) === settled)
            this.#pending.delete(settled.id);
        },
      );
      this.#operations.add(operation);
      operation.watchAbort();
      if (operation.active) {
        if (this.#channel.state === 'ready') this.#send(operation);
        else operation.arm(this.#options.readyTimeoutMs, 'READY wait');
      }
    } catch (error) {
      if (!operation) return Promise.reject(error);
      operation.finish(error);
    }
    return operation.promise;
  }

  #send(operation) {
    if (!operation.active || operation.sent || this.#channel.state !== 'ready')
      return;
    const { request, options, notification } = operation;
    try {
      if (!notification) {
        const { createRequestId } = this.#options;
        const id = createRequestId();
        if (typeof id !== 'string' || !id || this.#pending.has(id))
          throw new RpcError('id', 'Expected a fresh non-empty request ID');
        if (!operation.active) return;
        operation.id = id;
        this.#pending.set(id, operation);
      }
      if (!operation.active) return;
      operation.sent = true;
      operation.arm(options.timeoutMs, 'response');
      try {
        options.onWillSend?.();
      } catch (error) {
        this.#options.logger.error('RPC onWillSend failed', { error });
      }
      if (!operation.active) return;
      if (this.#channel.state !== 'ready')
        throw new RpcError('disconnected', 'Connection left READY');
      const message = {
        ...request,
        ...(notification ? {} : { id: operation.id }),
      };
      if (!this.#channel.send(message))
        throw new RpcError('send', 'RPC write was not accepted');
      if (notification) operation.finish();
    } catch (cause) {
      operation.finish(
        cause instanceof RpcError
          ? cause
          : new RpcError('send', 'RPC write failed', cause),
      );
    }
  }

  #receive(message) {
    if (this.#stopped || message === null || typeof message !== 'object')
      return;
    if (hasId(message) && isResponse(message)) {
      const operation = this.#pending.get(message.id);
      if (!operation) return;
      if (Object.hasOwn(message, 'error')) {
        const error =
          !Object.hasOwn(message, 'result') && isErrorData(message.error)
            ? new RpcResponseError(message.error, operation.request.method)
            : new RpcError('protocol', 'Malformed RPC response');
        operation.finish(error);
      } else operation.finish(undefined, message.result);
    } else if (isNotification(message))
      this.#events.emit('notification', message);
  }

  #onState(state) {
    if (state === 'stopped') {
      this.stop();
      return;
    }
    for (const operation of [...this.#operations]) {
      if (state === 'ready') this.#send(operation);
      else if (operation.sent || state === 'idle')
        operation.finish(new RpcError('disconnected', 'Connection left READY'));
    }
  }
}
