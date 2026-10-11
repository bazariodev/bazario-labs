import { expect, it, vi } from 'vitest';
import { createJitter } from '../index.js';

it('draws a fresh integer duration within inclusive bounds', () => {
  const random = vi
    .fn()
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0.5)
    .mockReturnValueOnce(0.999999);
  const draw = createJitter({ minMs: 40, maxMs: 60, random });
  expect(random).not.toHaveBeenCalled();
  expect([draw(), draw(), draw()]).toEqual([40, 50, 60]);
});

it('does not sample randomness for a fixed duration', () => {
  const random = vi.fn();
  expect(createJitter({ minMs: 1, maxMs: 1, random })()).toBe(1);
  expect(random).not.toHaveBeenCalled();
});

it('rejects invalid bounds and random sources', () => {
  for (const value of [-1, 0, 0.5, NaN, Infinity, 2_147_483_648]) {
    expect(() => createJitter({ minMs: value, maxMs: 100 })).toThrow(
      RangeError,
    );
    expect(() => createJitter({ minMs: 1, maxMs: value })).toThrow(RangeError);
  }
  expect(() => createJitter({ minMs: 2, maxMs: 1 })).toThrow(RangeError);
  expect(() => createJitter({ minMs: 1, maxMs: 2, random: null })).toThrow(
    TypeError,
  );
  for (const value of [-0.1, 1, NaN, Infinity, '0.5']) {
    expect(() =>
      createJitter({ minMs: 1, maxMs: 10, random: () => value })(),
    ).toThrow(RangeError);
  }
});

it('rejects zero-duration ranges before drawing or starting a consumer', () => {
  const random = vi.fn(() => 0);
  for (const maxMs of [0, 10])
    expect(() => createJitter({ minMs: 0, maxMs, random })).toThrow(RangeError);
  expect(random).not.toHaveBeenCalled();
  expect(createJitter({ minMs: 1, maxMs: 10, random })()).toBe(1);
});
