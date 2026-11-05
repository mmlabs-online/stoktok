import { describe, expect, it } from 'vitest';
import { addVnd, applyRatePpm, assertVnd, floorDiv, mulDiv, roundDiv } from './money';

describe('roundDiv half-up', () => {
  it('rounds half away from zero', () => {
    expect(roundDiv(7n, 2n)).toBe(4n);
    expect(roundDiv(5n, 3n)).toBe(2n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(roundDiv(10n, 5n)).toBe(2n);
  });
  it('is symmetric for negative numerators', () => {
    expect(roundDiv(-7n, 2n)).toBe(-4n);
    expect(roundDiv(-4n, 3n)).toBe(-1n);
  });
});

describe('applyRatePpm', () => {
  it('0.1% of 12,345,000 = 12,345', () => {
    expect(applyRatePpm(12_345_000, 1000)).toBe(12_345);
  });
  it('0.15% of 1,000,333 rounds half-up', () => {
    expect(applyRatePpm(1_000_333, 1500)).toBe(1500); // 1500.4995
    expect(applyRatePpm(1_000_334, 1500)).toBe(1501); // 1500.501
  });
});

describe('mulDiv', () => {
  it('is exact beyond 2^53 intermediates', () => {
    expect(mulDiv(100_000_000_000, 1_000_000, 3_000_000)).toBe(33_333_333_333);
  });
});

describe('assertVnd', () => {
  it('rejects non-integer, NaN and unsafe integers', () => {
    expect(() => assertVnd(1.5, 'x')).toThrow(RangeError);
    expect(() => assertVnd(NaN, 'x')).toThrow(RangeError);
    expect(() => assertVnd(2 ** 53, 'x')).toThrow(RangeError);
    expect(assertVnd(125400, 'x')).toBe(125400);
  });
});

describe('addVnd', () => {
  it('sums exactly and rejects unsafe results', () => {
    expect(addVnd(1, 2, -5)).toBe(-2);
    expect(addVnd()).toBe(0);
    expect(() => addVnd(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => addVnd(1.5, 1)).toThrow(RangeError);
  });
});

describe('floorDiv', () => {
  it('is exact when divisible and rounds down otherwise', () => {
    expect(floorDiv(9, 3)).toBe(3);
    expect(floorDiv(10, 3)).toBe(3);
    expect(floorDiv(2, 3)).toBe(0);
    expect(floorDiv(-1, 3)).toBe(-1);
  });
  it('is exact for large values', () => {
    expect(floorDiv(Number.MAX_SAFE_INTEGER, 2)).toBe(4_503_599_627_370_495);
  });
  it('rejects denominator <= 0 and non-integers', () => {
    expect(() => floorDiv(10, 0)).toThrow(RangeError);
    expect(() => floorDiv(10, -2)).toThrow(RangeError);
    expect(() => floorDiv(1.5, 2)).toThrow(RangeError);
    expect(() => floorDiv(10, 0.5)).toThrow(RangeError);
  });
});
