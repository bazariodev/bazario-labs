import { vi } from 'vitest';
import { Keepalive } from '../index.js';
import { createScheduler } from './scheduler.js';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function setup({
  scheduler = createScheduler(),
  logger = { error: vi.fn() },
  ...options
} = {}) {
  const rounds = [];
  const probe = vi.fn((signal) => {
    const round = { ...deferred(), signal };
    rounds.push(round);
    return round.promise;
  });
  const keepalive = new Keepalive({
    idleMs: 1000,
    deadlineMs: 100,
    probe,
    scheduler,
    logger,
    ...options,
  });
  const failures = [];
  keepalive.onFail((failure) => failures.push(failure));
  return { keepalive, probe, rounds, scheduler, logger, failures };
}
