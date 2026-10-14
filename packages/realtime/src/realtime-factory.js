import {
  createBackoffScheduler,
  defaultScheduler,
  Emitter,
} from '@bazariodev/coordination';
import { Fsm } from '@bazariodev/fsm';
import { Keepalive } from '@bazariodev/keepalive';

import { createFsmConfig } from './fsm-config.js';
import { RealtimeClient } from './realtime-client.js';

const NOOP_LOGGER = { debug() {}, error() {}, warn() {} };
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export function createRealtimeClient(options = {}) {
  const {
    createTransport,
    fsm,
    events,
    retry,
    connectivity,
    createKeepalive,
    keepalive,
    scheduler = defaultScheduler,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    logger = NOOP_LOGGER,
    reconnect = {},
    random,
  } = options;

  let retryDriver = retry;
  if (retry === undefined) {
    const jitter = reconnect.jitter;
    const inheritRandom =
      random !== undefined &&
      (jitter === undefined ||
        (jitter !== null &&
          typeof jitter === 'object' &&
          jitter.random === undefined));
    retryDriver = createBackoffScheduler({
      ...reconnect,
      scheduler,
      jitter: inheritRandom ? { ...jitter, random } : jitter,
    });
  }
  const monitorFactory =
    createKeepalive === undefined
      ? keepalive === undefined
        ? null
        : () =>
            new Keepalive({
              ...keepalive,
              scheduler,
              logger,
            })
      : createKeepalive;

  return new RealtimeClient({
    fsm: fsm === undefined ? new Fsm(createFsmConfig(logger)) : fsm,
    events: events === undefined ? new Emitter({ logger }) : events,
    createTransport,
    retry: retryDriver,
    createKeepalive: monitorFactory,
    connectivity,
    scheduler,
    connectTimeoutMs,
    logger,
  });
}
