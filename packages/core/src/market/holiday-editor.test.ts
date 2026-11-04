import { describe, expect, it } from 'vitest';
import { entryMessage } from '../entry/messages-vi';
import type { EntryErrorCode } from '../entry/messages-vi';
import { VN_MARKET_HOLIDAYS } from './holiday-calendar';
import {
  HOLIDAY_EDITOR_BOUNDS,
  HOLIDAY_NAMES_VI,
  addUserHoliday,
  checkNewHoliday,
  holidayCalendarView,
  holidayNameVi,
  parseHolidayList,
  removeUserHoliday,
  userHolidayDates,
  vnWeekdayLabel,
} from './holiday-editor';

const err = (raw: string) => {
  const r = parseHolidayList(raw);
  if (r.ok) throw new Error('expected error');
  return r.error;
};

describe('parseHolidayList', () => {
  it('empty, whitespace and empty items give []', () => {
    expect(parseHolidayList('')).toEqual({ ok: true, value: [] });
    expect(parseHolidayList(' , ,')).toEqual({ ok: true, value: [] });
  });
  it('sorts', () => {
    expect(parseHolidayList('2026-10-20,2026-03-02')).toEqual({ ok: true, value: ['2026-03-02', '2026-10-20'] });
  });
  it('invalid format or impossible date', () => {
    for (const v of ['2026-13-01', '2026-02-30', '20/10/2026', 'abc']) {
      expect(err(v)).toEqual({ code: 'HOLIDAY_DATE_INVALID', params: { value: v } });
    }
  });
  it('weekend', () => {
    expect(err('2026-10-24').code).toBe('HOLIDAY_WEEKEND');
    expect(err('2026-10-25').code).toBe('HOLIDAY_WEEKEND');
  });
  it('duplicate', () => {
    expect(err('2026-10-20,2026-10-20').code).toBe('HOLIDAY_DUPLICATE');
  });
  it('year range', () => {
    expect(err('2019-12-31')).toEqual({ code: 'HOLIDAY_YEAR_RANGE', params: { min: 2020, max: 2035 } });
    expect(err('2036-01-01').code).toBe('HOLIDAY_YEAR_RANGE');
    expect(parseHolidayList('2020-01-02,2035-12-31').ok).toBe(true);
  });
  it('too many', () => {
    const days: string[] = [];
    for (let d = new Date(Date.UTC(2030, 0, 1)); days.length < 101; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
    }
    expect(err(days.join(',')).code).toBe('HOLIDAY_TOO_MANY');
    expect(parseHolidayList(days.slice(0, 100).join(',')).ok).toBe(true);
  });
  it('seeded dates are stripped, not errors', () => {
    expect(parseHolidayList('2026-11-24,2026-10-20')).toEqual({ ok: true, value: ['2026-10-20'] });
    expect(parseHolidayList('2026-01-01')).toEqual({ ok: true, value: [] });
  });
  it('every error code has a Vietnamese message', () => {
    const codes: EntryErrorCode[] = [
      'HOLIDAY_DATE_INVALID', 'HOLIDAY_WEEKEND', 'HOLIDAY_DUPLICATE', 'HOLIDAY_SEEDED', 'HOLIDAY_YEAR_RANGE', 'HOLIDAY_TOO_MANY',
    ];
    for (const c of codes) expect(entryMessage(c, { date: '2026-10-24', value: 'x', min: 1, max: 2 })).not.toBe('');
    const e = err('2026-10-24');
    expect(entryMessage(e.code, e.params)).toContain('24/10/2026');
    expect(entryMessage(e.code, e.params)).toContain('Thứ Bảy');
  });
});

describe('checkNewHoliday / add / remove', () => {
  it('checks the add path', () => {
    expect(checkNewHoliday('', [])?.code).toBe('REQUIRED');
    expect(checkNewHoliday('2026-11-24', [])?.code).toBe('HOLIDAY_SEEDED');
    expect(checkNewHoliday('2026-10-20', ['2026-10-20'])?.code).toBe('HOLIDAY_DUPLICATE');
    expect(checkNewHoliday('2026-10-24', [])?.code).toBe('HOLIDAY_WEEKEND');
    expect(checkNewHoliday('2026-10-20', [])).toBeNull();
    const full = Array.from({ length: HOLIDAY_EDITOR_BOUNDS.maxUserDates }, (_, i) => `x${i}`);
    expect(checkNewHoliday('2026-10-20', full)?.code).toBe('HOLIDAY_TOO_MANY');
  });
  it('addUserHoliday sorts without mutating; passes errors through', () => {
    const cur = ['2026-10-20'];
    expect(addUserHoliday(cur, '2026-03-02')).toEqual({ ok: true, dates: ['2026-03-02', '2026-10-20'] });
    expect(cur).toEqual(['2026-10-20']);
    expect(addUserHoliday(cur, '2026-10-24')).toMatchObject({ ok: false, error: { code: 'HOLIDAY_WEEKEND' } });
  });
  it('removeUserHoliday removes exactly one date', () => {
    expect(removeUserHoliday(['2026-03-02', '2026-10-20'], '2026-03-02')).toEqual(['2026-10-20']);
  });
});

describe('userHolidayDates', () => {
  it('removes seed, dedupes, sorts, keeps invalid', () => {
    expect(userHolidayDates(['2026-11-24', '2026-10-20', '2026-10-20', 'bad'])).toEqual(['2026-10-20', 'bad']);
  });
});

describe('holidayCalendarView', () => {
  it('seed only: years newest first, counts, provisional', () => {
    const v = holidayCalendarView([], []);
    expect(v.years.map((y) => y.year)).toEqual([2027, 2026, 2025]);
    expect(v.years.flatMap((y) => y.rows)).toHaveLength(38);
    expect(v.summary).toEqual({ total: 38, provisional: 13, user: 0 });
    const rows = v.years.flatMap((y) => y.rows);
    expect(rows.find((r) => r.date === '2026-11-24')?.status).toBe('provisional');
    expect(v.years[0]!.rows.every((r) => r.status === 'provisional')).toBe(true);
  });
  it('seeded row details', () => {
    const r = holidayCalendarView([], []).years.flatMap((y) => y.rows).find((x) => x.date === '2026-11-24')!;
    expect(r).toMatchObject({ removable: false, name: 'Ngày Văn hóa Việt Nam', weekdayLabel: 'Thứ Ba', dateLabel: '24/11/2026' });
    expect(r.source).toBeTruthy();
  });
  it('user rows, pending and removed', () => {
    const v = holidayCalendarView(['2026-10-20', '2026-03-02'], ['2026-10-20', '2026-10-21']);
    const rows = v.years.flatMap((y) => y.rows);
    expect(rows.find((r) => r.date === '2026-10-20')).toMatchObject({ status: 'user', removable: true, pending: false, name: null });
    expect(rows.find((r) => r.date === '2026-10-21')?.pending).toBe(true);
    expect(v.removed).toEqual(['2026-03-02']);
    expect(v.summary.user).toBe(2);
  });
  it('user date in 2024 makes a group; invalid goes to invalid', () => {
    const v = holidayCalendarView([], ['2024-05-06', 'bad']);
    expect(v.years.map((y) => y.year)).toEqual([2027, 2026, 2025, 2024]);
    expect(v.invalid).toEqual(['bad']);
  });
});

describe('names and weekdays', () => {
  it('every seed name has a Vietnamese label; unknown unchanged', () => {
    for (const name of new Set(VN_MARKET_HOLIDAYS.map((h) => h.name))) expect(HOLIDAY_NAMES_VI[name]).toBeTruthy();
    expect(holidayNameVi('Unknown')).toBe('Unknown');
  });
  it('vnWeekdayLabel', () => {
    expect(vnWeekdayLabel('2026-10-20')).toBe('Thứ Ba');
    expect(vnWeekdayLabel('2026-10-25')).toBe('Chủ Nhật');
  });
});
