import { expect, it, vi } from 'vitest';
import { setup } from './helpers.js';

it('redraws idle timing on activity but keeps a pending response deadline fixed', () => {
  const idleMs = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200);
  const { keepalive, scheduler, probe, failures } = setup({ idleMs });
  keepalive.start();
  scheduler.advance(50);
  keepalive.activity();
  scheduler.advance(199);
  expect(probe).not.toHaveBeenCalled();
  scheduler.advance(1);
  expect(probe).toHaveBeenCalledOnce();
  scheduler.advance(50);
  keepalive.activity();
  expect(idleMs).toHaveBeenCalledTimes(2);
  scheduler.advance(50);
  expect(failures).toEqual([{ type: 'timeout' }]);
  expect(scheduler.pending()).toBe(0);
});

it('reports a duration source failure and releases its timers', () => {
  const error = new Error('random source failed');
  const { keepalive, scheduler, failures } = setup({
    idleMs: () => {
      throw error;
    },
  });
  keepalive.start();
  expect(failures).toEqual([{ type: 'error', error }]);
  expect(scheduler.pending()).toBe(0);
});
