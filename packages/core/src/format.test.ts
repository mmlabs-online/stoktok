import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatVnd,
} from './format';

describe('formatVnd', () => {
  it('formats integers', () => {
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(1234567)).toBe('1.234.567 ₫');
    expect(formatVnd(-1234567)).toBe('-1.234.567 ₫');
    expect(formatVnd(1234567, { symbol: false })).toBe('1.234.567');
    expect(formatVnd(Number.MAX_SAFE_INTEGER)).toBe('9.007.199.254.740.991 ₫');
    expect(formatVnd(2_147_483_648)).toBe('2.147.483.648 ₫');
  });
  it('signs only positive values', () => {
    expect(formatVnd(1000, { signed: true })).toBe('+1.000 ₫');
    expect(formatVnd(0, { signed: true })).toBe('0 ₫');
  });
  it('throws on non-integer', () => {
    for (const v of [1.5, NaN, Infinity, 2 ** 53]) expect(() => formatVnd(v)).toThrow(RangeError);
  });
});

describe('formatPrice', () => {
  it('shows thousand VND with 2 decimals', () => {
    expect(formatPrice(125400)).toBe('125,40');
    expect(formatPrice(0)).toBe('0,00');
    expect(formatPrice(1_234_500)).toBe('1.234,50');
  });
  it('rounds half away from zero to 10 VND', () => {
    expect(formatPrice(125405)).toBe('125,41');
    expect(formatPrice(4)).toBe('0,00');
    expect(formatPrice(5)).toBe('0,01');
    expect(formatPrice(-1205, { signed: true })).toBe('-1,21');
  });
  it('signs', () => {
    expect(formatPrice(1200, { signed: true })).toBe('+1,20');
    expect(formatPrice(-1200, { signed: true })).toBe('-1,20');
    expect(formatPrice(0, { signed: true })).toBe('0,00');
  });
  it('throws on non-integer', () => {
    expect(() => formatPrice(125.4)).toThrow(RangeError);
  });
});

describe('formatPercent', () => {
  it('formats ppm', () => {
    expect(formatPercent(12_345)).toBe('1,23%');
    expect(formatPercent(12_350)).toBe('1,24%');
    expect(formatPercent(-12_350)).toBe('-1,24%');
    expect(formatPercent(0)).toBe('0,00%');
    expect(formatPercent(1_000_000)).toBe('100,00%');
    expect(formatPercent(123_456_789)).toBe('12.345,68%');
  });
  it('signs', () => {
    expect(formatPercent(9_700, { signed: true })).toBe('+0,97%');
    expect(formatPercent(0, { signed: true })).toBe('0,00%');
  });
  it('throws on non-integer', () => {
    expect(() => formatPercent(0.5)).toThrow(RangeError);
  });
});

describe('formatQuantity', () => {
  it('groups', () => {
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(100)).toBe('100');
    expect(formatQuantity(1500)).toBe('1.500');
    expect(formatQuantity(-1500)).toBe('-1.500');
    expect(formatQuantity(1_000_000)).toBe('1.000.000');
  });
  it('throws on non-integer', () => {
    expect(() => formatQuantity(1.5)).toThrow(RangeError);
  });
});

describe('formatDate', () => {
  it('formats', () => {
    expect(formatDate('2026-10-23')).toBe('23/10/2026');
    expect(formatDate('2026-01-05')).toBe('05/01/2026');
  });
  it('throws on bad input', () => {
    for (const v of ['2026-13-01', '2026-10-32', '23/10/2026', '', '2026-10-23T00:00:00Z']) {
      expect(() => formatDate(v)).toThrow(RangeError);
    }
  });
});

describe('formatDateTime', () => {
  it('uses Vietnam time', () => {
    expect(formatDateTime('2026-10-23T02:05:00Z')).toBe('09:05 23/10/2026');
    expect(formatDateTime('2026-10-22T18:30:00Z')).toBe('01:30 23/10/2026');
    expect(formatDateTime('2026-10-23T09:05:00+07:00')).toBe('09:05 23/10/2026');
    expect(formatDateTime('2026-10-23T00:00:00Z')).toBe('07:00 23/10/2026');
    expect(formatDateTime('2026-10-22T17:00:00Z')).toBe('00:00 23/10/2026');
  });
  it('throws on bad input', () => {
    expect(() => formatDateTime('not a date')).toThrow(RangeError);
  });
});
