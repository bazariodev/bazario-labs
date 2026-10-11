import { expect, it, vi } from 'vitest';
import { Keepalive } from '../index.js';
import { createScheduler } from './scheduler.js';

it('uses generic activity to reset only the idle window', () => {
  const scheduler = createScheduler();
  const probe = vi.fn(() => new Promise(() => {}));
  const keepalive = new Keepalive({
    probe,
    idleMs: 1000,
    deadlineMs: 100,
    scheduler,
  });
  const failures = [];
  keepalive.onFail((failure) => failures.push(failure));

  keepalive.start();
  scheduler.advance(600);
  keepalive.activity();
  scheduler.advance(999);
  expect(probe).not.toHaveBeenCalled();
  scheduler.advance(1);
  expect(probe).toHaveBeenCalledOnce();

  scheduler.advance(50);
  keepalive.activity();
  scheduler.advance(50);
  expect(failures).toEqual([{ type: 'timeout' }]);
  expect(scheduler.pending()).toBe(0);
});
