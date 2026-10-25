import { describe, expect, it } from 'vitest';
import { expectedPriceDate, priceStatus } from './freshness';

const CUT = 18 * 60;
// VN = UTC+7, so 18:00 VN = 11:00Z.
describe('expectedPriceDate', () => {
  it('weekday before cutoff -> previous trading day', () => {
    expect(expectedPriceDate(new Date('2026-10-21T10:59:00Z'), [], CUT)).toBe('2026-10-20');
  });
  it('weekday at/after cutoff -> today', () => {
    expect(expectedPriceDate(new Date('2026-10-21T11:00:00Z'), [], CUT)).toBe('2026-10-21');
  });
  it('Saturday and Sunday -> Friday', () => {
    expect(expectedPriceDate(new Date('2026-10-24T12:00:00Z'), [], CUT)).toBe('2026-10-23');
    expect(expectedPriceDate(new Date('2026-10-25T12:00:00Z'), [], CUT)).toBe('2026-10-23');
  });
  it('Monday before cutoff -> Friday', () => {
    expect(expectedPriceDate(new Date('2026-10-26T03:00:00Z'), [], CUT)).toBe('2026-10-23');
  });
  it('holiday today after cutoff -> previous trading day', () => {
    expect(expectedPriceDate(new Date('2026-10-21T12:00:00Z'), ['2026-10-21'], CUT)).toBe('2026-10-20');
  });
  it('day after a holiday before cutoff skips the holiday', () => {
    expect(expectedPriceDate(new Date('2026-10-22T03:00:00Z'), ['2026-10-21'], CUT)).toBe('2026-10-20');
  });
  it('UTC Friday 23:30 is VN Saturday 06:30 -> Friday', () => {
    expect(expectedPriceDate(new Date('2026-10-23T23:30:00Z'), [], CUT)).toBe('2026-10-23');
  });
});

describe('priceStatus', () => {
  it('missing / stale / fresh', () => {
    expect(priceStatus(undefined, '2026-10-23')).toBe('missing');
    expect(priceStatus({ tradeDate: '2026-10-22' }, '2026-10-23')).toBe('stale');
    expect(priceStatus({ tradeDate: '2026-10-23' }, '2026-10-23')).toBe('fresh');
    expect(priceStatus({ tradeDate: '2026-10-24' }, '2026-10-23')).toBe('fresh');
  });
});
