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
    const retryOptions = { ...reconnect, scheduler };
    const jitter = reconnect.jitter;
    if (random !== undefined && jitter === undefined) {
      retryOptions.jitter = { random };
    } else if (
      random !== undefined &&
      jitter !== false &&
      jitter !== null &&
      typeof jitter === 'object' &&
      jitter.random === undefined
    ) {
      retryOptions.jitter = { ...jitter, random };
    }
    retryDriver = createBackoffScheduler(retryOptions);
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
    scheduler,
    connectTimeoutMs,
    logger,
  });
}
