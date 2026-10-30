/** Trading-day arithmetic on 'YYYY-MM-DD' strings. Holidays are an input (R5). */

import { VN_TIME_ZONE } from './format';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(date: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`invalid date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== date) throw new RangeError(`invalid date: ${date}`);
  return d;
}

export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string') return false;
  try {
    toUtc(date);
    return true;
  } catch {
    return false;
  }
}

export function isTradingDay(date: string, holidays: readonly string[]): boolean {
  const dow = toUtc(date).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.includes(date);
}

/** The date n trading days after `date` (n = 0 returns `date`). */
export function addTradingDays(date: string, n: number, holidays: readonly string[]): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  const d = toUtc(date);
  let left = n;
  let current = date;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    current = d.toISOString().slice(0, 10);
    if (isTradingDay(current, holidays)) left -= 1;
  }
  return current;
}

/** Trading days from `from` to `to`, both inclusive, oldest first. Empty when from > to. */
export function tradingDaysBetween(from: string, to: string, holidays: readonly string[]): string[] {
  const d = toUtc(from);
  toUtc(to);
  const out: string[] = [];
  let current = from;
  while (current <= to) {
    if (isTradingDay(current, holidays)) out.push(current);
    d.setUTCDate(d.getUTCDate() + 1);
    current = d.toISOString().slice(0, 10);
  }
  return out;
}

/** First instant and last whole second of a VN calendar day (+07:00, no DST), as ISO UTC strings. */
export function vnDayBoundsUtc(date: string): { fromTs: string; toTs: string } {
  toUtc(date);
  return {
    fromTs: new Date(`${date}T00:00:00+07:00`).toISOString(),
    toTs: new Date(`${date}T23:59:59+07:00`).toISOString(),
  };
}

/** The trading day n trading days before `date` (n = 0 returns `date`). */
export function subtractTradingDays(date: string, n: number, holidays: readonly string[]): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  const d = toUtc(date);
  let left = n;
  let current = date;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    current = d.toISOString().slice(0, 10);
    if (isTradingDay(current, holidays)) left -= 1;
  }
  return current;
}

const vnDateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date ('YYYY-MM-DD') of an instant in Vietnam time. */
export function vnDateOf(instant: Date): string {
  const p: Record<string, string> = {};
  for (const part of vnDateFormat.formatToParts(instant)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** The latest trading day strictly before `date`. */
export function previousTradingDay(date: string, holidays: readonly string[]): string {
  const d = toUtc(date);
  let current: string;
  do {
    d.setUTCDate(d.getUTCDate() - 1);
    current = d.toISOString().slice(0, 10);
  } while (!isTradingDay(current, holidays));
  return current;
}

const vnClockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Minutes since 00:00 Vietnam time of an instant. */
export function vnMinutesOf(instant: Date): number {
  const p: Record<string, string> = {};
  for (const part of vnClockFormat.formatToParts(instant)) p[part.type] = part.value;
  return Number(p.hour) * 60 + Number(p.minute);
}
