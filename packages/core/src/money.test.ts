import { describe, expect, it } from 'vitest';
import { applyRatePpm, assertVnd, mulDiv, roundDiv } from './money';

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
