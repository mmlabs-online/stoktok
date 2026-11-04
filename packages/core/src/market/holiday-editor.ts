/**
 * Holiday calendar editing (R1, R5): validation, normalization and the display model for the settings card.
 * The seeded calendar is never written to `settings.holidays`; only dates the user added are stored.
 */
import { dayOfWeek, isValidDate } from '../calendar';
import type { EntryError } from '../entry/messages-vi';
import { formatDate } from '../format';
import { SEEDED_HOLIDAY_DATES, VN_MARKET_HOLIDAYS } from './holiday-calendar';

/** Sanity bounds for user-added dates (not market rules). */
export const HOLIDAY_EDITOR_BOUNDS = { minYear: 2020, maxYear: 2035, maxUserDates: 100 } as const;

/** Vietnamese labels for the seeded (English) holiday names. */
export const HOLIDAY_NAMES_VI: Readonly<Record<string, string>> = {
  "New Year's Day": 'Tết Dương lịch',
  'Tet Nguyen Dan (Tet At Ty)': 'Tết Nguyên đán Ất Tỵ',
  'Tet Nguyen Dan (Tet Binh Ngo)': 'Tết Nguyên đán Bính Ngọ',
  'Tet Nguyen Dan (Tet Dinh Mui)': 'Tết Nguyên đán Đinh Mùi',
  "Hung Kings' Day": 'Giỗ Tổ Hùng Vương',
  "Hung Kings' Day (substitute for Sunday 2026-04-26)": 'Giỗ Tổ Hùng Vương (nghỉ bù Chủ Nhật 26/04/2026)',
  'Reunification Day': 'Ngày Giải phóng miền Nam (30/4)',
  'International Labour Day': 'Ngày Quốc tế Lao động (1/5)',
  'International Labour Day (substitute for Saturday 2027-05-01)': 'Ngày Quốc tế Lao động (nghỉ bù Thứ Bảy 01/05/2027)',
  'Bridge day (swapped with Saturday 2025-04-26)': 'Nghỉ hoán đổi (làm bù Thứ Bảy 26/04/2025)',
  'Bridge day (swapped with Saturday 2026-01-10)': 'Nghỉ hoán đổi (làm bù Thứ Bảy 10/01/2026)',
  'Bridge day (swapped with Saturday 2026-08-22)': 'Nghỉ hoán đổi (làm bù Thứ Bảy 22/08/2026)',
  'National Day holiday': 'Nghỉ lễ Quốc khánh',
  'National Day': 'Quốc khánh (2/9)',
  'Vietnamese Culture Day': 'Ngày Văn hóa Việt Nam',
};

export function holidayNameVi(name: string): string {
  return HOLIDAY_NAMES_VI[name] ?? name;
}

const WEEKDAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

export function vnWeekdayLabel(date: string): string {
  return WEEKDAYS_VI[dayOfWeek(date)]!;
}

/** Splits a comma-separated list; trims and drops empty items. No validation. */
export function splitHolidayList(raw: string): string[] {
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

const sortedUnique = (xs: readonly string[]) => [...new Set(xs)].sort();

/** Stored dates minus the seeded calendar, unique and sorted. Invalid strings are kept so the editor can show them. */
export function userHolidayDates(stored: readonly string[]): string[] {
  return sortedUnique(stored.filter((d) => !SEEDED_HOLIDAY_DATES.includes(d)));
}

/** Format, year bound and weekday checks for one date. */
function checkDate(date: string): EntryError | null {
  if (!isValidDate(date)) return { code: 'HOLIDAY_DATE_INVALID', params: { value: date } };
  const { minYear, maxYear } = HOLIDAY_EDITOR_BOUNDS;
  const year = Number(date.slice(0, 4));
  if (year < minYear || year > maxYear) return { code: 'HOLIDAY_YEAR_RANGE', params: { min: minYear, max: maxYear } };
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return { code: 'HOLIDAY_WEEKEND', params: { date } };
  return null;
}

const tooMany: EntryError = { code: 'HOLIDAY_TOO_MANY', params: { max: HOLIDAY_EDITOR_BOUNDS.maxUserDates } };

/**
 * Validates a submitted list. Seeded dates are dropped (normalization, not an error). First error wins.
 * Returns the sorted user-owned dates.
 */
export function parseHolidayList(raw: string): { ok: true; value: string[] } | { ok: false; error: EntryError } {
  const seen = new Set<string>();
  for (const item of splitHolidayList(raw)) {
    const err = checkDate(item);
    if (err) return { ok: false, error: err };
    if (seen.has(item)) return { ok: false, error: { code: 'HOLIDAY_DUPLICATE', params: { date: item } } };
    seen.add(item);
  }
  const value = userHolidayDates([...seen]);
  if (value.length > HOLIDAY_EDITOR_BOUNDS.maxUserDates) return { ok: false, error: tooMany };
  return { ok: true, value };
}

/** Checks one date typed into the add box against the current user list. */
export function checkNewHoliday(candidate: string, currentUser: readonly string[]): EntryError | null {
  const date = candidate.trim();
  if (date === '') return { code: 'REQUIRED' };
  const err = checkDate(date);
  if (err) return err;
  if (SEEDED_HOLIDAY_DATES.includes(date)) return { code: 'HOLIDAY_SEEDED', params: { date } };
  if (currentUser.includes(date)) return { code: 'HOLIDAY_DUPLICATE', params: { date } };
  if (currentUser.length >= HOLIDAY_EDITOR_BOUNDS.maxUserDates) return tooMany;
  return null;
}

export function addUserHoliday(
  current: readonly string[],
  candidate: string,
): { ok: true; dates: string[] } | { ok: false; error: EntryError } {
  const error = checkNewHoliday(candidate, current);
  if (error) return { ok: false, error };
  return { ok: true, dates: sortedUnique([...current, candidate.trim()]) };
}

export function removeUserHoliday(current: readonly string[], date: string): string[] {
  return current.filter((d) => d !== date);
}

export interface HolidayRow {
  date: string;
  dateLabel: string;
  weekdayLabel: string;
  /** Vietnamese name; null for user-added dates. */
  name: string | null;
  status: 'seeded' | 'provisional' | 'user';
  source: string | null;
  removable: boolean;
  /** User date not yet saved. */
  pending: boolean;
}

export interface HolidayCalendarView {
  /** Newest year first; rows oldest first. */
  years: { year: number; rows: HolidayRow[] }[];
  /** Current values that are not valid dates (shown so they can be removed). */
  invalid: string[];
  /** Saved user dates that are no longer in the current list. */
  removed: string[];
  summary: { total: number; provisional: number; user: number };
}

/** Display model: seeded calendar plus the valid current user dates, grouped by year. */
export function holidayCalendarView(savedUser: readonly string[], currentUser: readonly string[]): HolidayCalendarView {
  const rows: HolidayRow[] = VN_MARKET_HOLIDAYS.map((h) => ({
    date: h.date,
    dateLabel: formatDate(h.date),
    weekdayLabel: vnWeekdayLabel(h.date),
    name: holidayNameVi(h.name),
    status: h.provisional ? 'provisional' : 'seeded',
    source: h.source,
    removable: false,
    pending: false,
  }));
  const invalid: string[] = [];
  for (const date of sortedUnique(currentUser)) {
    if (!isValidDate(date)) invalid.push(date);
    else if (!SEEDED_HOLIDAY_DATES.includes(date)) {
      rows.push({
        date,
        dateLabel: formatDate(date),
        weekdayLabel: vnWeekdayLabel(date),
        name: null,
        status: 'user',
        source: null,
        removable: true,
        pending: !savedUser.includes(date),
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const byYear = new Map<number, HolidayRow[]>();
  for (const r of rows) {
    const year = Number(r.date.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), r]);
  }
  return {
    years: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, yearRows]) => ({ year, rows: yearRows })),
    invalid,
    removed: sortedUnique(savedUser.filter((d) => !currentUser.includes(d))),
    summary: {
      total: rows.length,
      provisional: rows.filter((r) => r.status === 'provisional').length,
      user: rows.filter((r) => r.status === 'user').length,
    },
  };
}
