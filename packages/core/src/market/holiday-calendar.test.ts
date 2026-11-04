import { describe, expect, test } from 'vitest';
import { addTradingDays, isValidDate } from '../calendar';
import { DEFAULT_PRICE_CUTOFF_MINUTES_VN } from '../portfolio/config';
import { expectedPriceDate } from '../portfolio/freshness';
import { SEEDED_HOLIDAY_DATES, SEEDED_HOLIDAY_YEARS, VN_MARKET_HOLIDAYS, effectiveHolidays } from './holiday-calendar';

const SNAPSHOT = [
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-04-07', '2025-04-30', '2025-05-01', '2025-05-02', '2025-09-01', '2025-09-02',
  '2026-01-01', '2026-01-02', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-04-27', '2026-04-30', '2026-05-01', '2026-08-31', '2026-09-01', '2026-09-02', '2026-11-24',
  '2027-01-01', '2027-02-04', '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10',
  '2027-04-16', '2027-04-30', '2027-05-03', '2027-09-02', '2027-09-03', '2027-11-24',
];

describe('VN_MARKET_HOLIDAYS', () => {
  test('every date is a valid ISO date', () => {
    for (const d of SEEDED_HOLIDAY_DATES) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isValidDate(d)).toBe(true);
    }
  });
  test('no Saturday or Sunday, and not the make-up Saturdays', () => {
    for (const d of SEEDED_HOLIDAY_DATES) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      expect(wd).not.toBe(0);
      expect(wd).not.toBe(6);
    }
    for (const d of ['2025-04-26', '2026-01-10', '2026-08-22']) expect(SEEDED_HOLIDAY_DATES).not.toContain(d);
  });
  test('strictly ascending (sorted, no duplicates)', () => {
    for (let i = 1; i < SEEDED_HOLIDAY_DATES.length; i++) {
      expect(SEEDED_HOLIDAY_DATES[i]! > SEEDED_HOLIDAY_DATES[i - 1]!).toBe(true);
    }
  });
  test('covers 2025, 2026 and 2027', () => {
    expect(SEEDED_HOLIDAY_YEARS).toEqual([2025, 2026, 2027]);
    for (const y of SEEDED_HOLIDAY_YEARS) {
      expect(SEEDED_HOLIDAY_DATES.some((d) => d.startsWith(`${y}-`))).toBe(true);
    }
  });
  test('every entry has a name and a source', () => {
    for (const x of VN_MARKET_HOLIDAYS) {
      expect(x.name.length).toBeGreaterThan(0);
      expect(x.source.length).toBeGreaterThan(0);
    }
  });
  test('provisional: every 2027 entry and 2026-11-24, nothing else', () => {
    for (const x of VN_MARKET_HOLIDAYS) {
      expect(x.provisional).toBe(x.date.startsWith('2027-') || x.date === '2026-11-24');
    }
  });
  test('exact date snapshot (38 dates)', () => {
    expect(SNAPSHOT).toHaveLength(38);
    expect([...SEEDED_HOLIDAY_DATES]).toEqual(SNAPSHOT);
  });
});

describe('effectiveHolidays', () => {
  test('empty, null and undefined give the seed', () => {
    expect(effectiveHolidays([])).toEqual([...SEEDED_HOLIDAY_DATES]);
    expect(effectiveHolidays(null)).toEqual([...SEEDED_HOLIDAY_DATES]);
    expect(effectiveHolidays(undefined)).toEqual([...SEEDED_HOLIDAY_DATES]);
  });
  test('stored dates are kept: union, sorted, unique', () => {
    const out = effectiveHolidays(['2026-10-20']);
    expect(out).toContain('2026-10-20');
    for (const d of SEEDED_HOLIDAY_DATES) expect(out).toContain(d);
    expect(out).toEqual([...out].sort());
    expect(new Set(out).size).toBe(out.length);
  });
  test('a stored date already in the seed is not duplicated; input is not mutated', () => {
    const stored = ['2026-09-02', '2026-01-01'];
    const out = effectiveHolidays(stored);
    expect(out).toHaveLength(SEEDED_HOLIDAY_DATES.length);
    expect(stored).toEqual(['2026-09-02', '2026-01-01']);
  });
  test('T+2 from Fri 2026-02-13 settles after Tet', () => {
    expect(addTradingDays('2026-02-13', 2, effectiveHolidays([]))).toBe('2026-02-24');
  });
  test('expected price date on Mon 2026-02-23 09:00 VN is the last session before Tet', () => {
    expect(expectedPriceDate(new Date('2026-02-23T02:00:00Z'), effectiveHolidays([]), DEFAULT_PRICE_CUTOFF_MINUTES_VN)).toBe('2026-02-13');
  });
});
