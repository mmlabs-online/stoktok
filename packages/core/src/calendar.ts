/** Trading-day arithmetic on 'YYYY-MM-DD' strings. Holidays are an input (R5). */

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
