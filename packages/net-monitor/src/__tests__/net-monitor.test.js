import { describe, expect, it, vi } from 'vitest';

import { BrowserNetMonitor } from '../index.js';

function makePlatform(onLine = true) {
  const listeners = new Map();
  const platform = {
    navigator: { onLine },
    addEventListener: vi.fn((type, listener) => {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    }),
    removeEventListener: vi.fn((type, listener) => {
      listeners.get(type)?.delete(listener);
    }),
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  return platform;
}

describe('BrowserNetMonitor', () => {
  it('reads online state without attaching listeners, then attaches for subscribers', () => {
    const platform = makePlatform();
    const monitor = new BrowserNetMonitor({ platform });
    expect(monitor.getSnapshot()).toBe('online');
    expect(platform.addEventListener).not.toHaveBeenCalled();

    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    expect(platform.count('online')).toBe(1);
    expect(platform.count('offline')).toBe(1);
    expect(listener).not.toHaveBeenCalled();

    platform.navigator.onLine = false;
    platform.emit('offline');
    expect(listener).toHaveBeenCalledWith('offline');
    expect(monitor.getSnapshot()).toBe('offline');
    unsubscribe();
    expect(platform.count('online')).toBe(0);
    expect(platform.count('offline')).toBe(0);
  });

  it('attaches again and samples current state after a gap', () => {
    const platform = makePlatform(true);
    const monitor = new BrowserNetMonitor({ platform });
    const first = vi.fn();
    monitor.subscribe(first)();
    platform.navigator.onLine = false;
    const second = vi.fn();
    const unsubscribe = monitor.subscribe(second);
    expect(second).toHaveBeenCalledWith('offline');
    expect(monitor.getSnapshot()).toBe('offline');
    unsubscribe();
  });

  it('gives duplicate callback subscriptions independent idempotent cleanup', () => {
    const platform = makePlatform(true);
    const monitor = new BrowserNetMonitor({ platform });
    const listener = vi.fn();
    const first = monitor.subscribe(listener);
    const second = monitor.subscribe(listener);
    expect(platform.addEventListener).toHaveBeenCalledTimes(2);
    listener.mockClear();
    first();
    first();
    platform.emit('offline');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(platform.count('offline')).toBe(1);
    second();
    expect(platform.count('offline')).toBe(0);
  });

  it('contains listener errors and stops old delivery after re-entry', () => {
    const platform = makePlatform(true);
    const onListenerError = vi.fn();
    const monitor = new BrowserNetMonitor({ platform, onListenerError });
    const older = vi.fn(() => platform.emit('online'));
    const newer = vi.fn();
    monitor.subscribe(older);
    monitor.subscribe(() => {
      throw new Error('listener failed');
    });
    monitor.subscribe(newer);

    platform.navigator.onLine = false;
    platform.emit('offline');
    expect(older).toHaveBeenCalledWith('offline');
    expect(onListenerError).toHaveBeenCalledOnce();
    expect(newer).not.toHaveBeenCalledWith('offline');
    expect(newer).toHaveBeenCalledWith('online');
  });

  it('does not deliver an old notification after an offline-online-offline re-entry', () => {
    const platform = makePlatform(true);
    const monitor = new BrowserNetMonitor({ platform });
    let nested = false;
    monitor.subscribe((state) => {
      if (state === 'offline' && !nested) {
        nested = true;
        platform.emit('online');
        platform.emit('offline');
      }
    });
    const later = vi.fn();
    monitor.subscribe(later);

    platform.emit('offline');
    expect(later.mock.calls).toEqual([['online'], ['offline']]);
  });

  it('honors unsubscribe and stop during a notification', () => {
    const platform = makePlatform(true);
    const monitor = new BrowserNetMonitor({ platform });
    const removed = vi.fn();
    let unsubscribe;
    monitor.subscribe(() => unsubscribe());
    unsubscribe = monitor.subscribe(removed);
    platform.emit('offline');
    expect(removed).not.toHaveBeenCalled();

    const stoppedPlatform = makePlatform(true);
    const stopped = new BrowserNetMonitor({ platform: stoppedPlatform });
    const later = vi.fn();
    stopped.subscribe(() => stopped.stop());
    stopped.subscribe(later);
    stoppedPlatform.emit('offline');
    expect(later).not.toHaveBeenCalled();
  });

  it('cleans up when an attached listener stops the monitor during attachment', () => {
    const platform = makePlatform(true);
    const addEventListener = platform.addEventListener;
    platform.addEventListener = vi.fn((type, listener) => {
      addEventListener(type, listener);
      if (type === 'online') listener();
    });
    const monitor = new BrowserNetMonitor({ platform });
    monitor.subscribe(() => monitor.stop());
    expect(platform.count('online')).toBe(0);
    expect(platform.count('offline')).toBe(0);
  });

  it('returns unknown when the platform has no browser state', () => {
    const monitor = new BrowserNetMonitor({ platform: {} });
    expect(monitor.getSnapshot()).toBe('unknown');
    const listener = vi.fn();
    monitor.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('releases a partial attachment when the second listener fails', () => {
    const platform = makePlatform(true);
    const addEventListener = platform.addEventListener;
    platform.addEventListener = vi.fn((type, listener) => {
      addEventListener(type, listener);
      if (type === 'offline') throw new Error('cannot attach');
    });
    const monitor = new BrowserNetMonitor({ platform });
    expect(() => monitor.subscribe(() => {})).toThrow('cannot attach');
    expect(platform.count('online')).toBe(0);
    platform.addEventListener = addEventListener;
    const unsubscribe = monitor.subscribe(() => {});
    expect(platform.count('online')).toBe(1);
    unsubscribe();
  });

  it('stops permanently and keeps the last snapshot', () => {
    const platform = makePlatform(true);
    const monitor = new BrowserNetMonitor({ platform });
    const listener = vi.fn();
    monitor.subscribe(listener);
    platform.navigator.onLine = false;
    platform.emit('offline');
    monitor.stop();
    monitor.stop();
    platform.navigator.onLine = true;
    expect(monitor.getSnapshot()).toBe('offline');
    expect(monitor.subscribe(listener)).toBeTypeOf('function');
    platform.emit('online');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(platform.count('offline')).toBe(0);
  });
});
