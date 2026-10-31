import { isValidDate } from '../calendar';

/** A quarter label 'YYYYQn', n in 1..4 (the source's fiscal-quarter label, treated as calendar quarter). */
const PERIOD_RE = /^(\d{4})Q([1-4])$/;
const DAY_MS = 86_400_000;

/** `data_gaps.data_type` of a missing financials quarter. */
export const FINANCIALS_GAP_TYPE = 'financials';
const LAST_DAY = ['', '03-31', '06-30', '09-30', '12-31'] as const;

/** null unless year is an integer in 1990..2100 and quarter an integer in 1..4. */
export function periodOf(year: unknown, quarter: unknown): string | null {
  if (typeof year !== 'number' || typeof quarter !== 'number') return null;
  if (!Number.isInteger(year) || !Number.isInteger(quarter)) return null;
  if (year < 1990 || year > 2100 || quarter < 1 || quarter > 4) return null;
  return `${year}Q${quarter}`;
}

export function parsePeriod(period: string): { year: number; quarter: number } | null {
  const m = PERIOD_RE.exec(period);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

function mustParse(period: string): { year: number; quarter: number } {
  const p = parsePeriod(period);
  if (!p) throw new RangeError(`invalid period: ${period}`);
  return p;
}

export function addQuarters(period: string, n: number): string {
  const { year, quarter } = mustParse(period);
  const index = year * 4 + (quarter - 1) + n;
  return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
}

/** Lexicographic order equals chronological order for valid periods. */
export function comparePeriods(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** First instant and last whole second of the quarter in Asia/Ho_Chi_Minh (+07:00, no DST), as ISO UTC strings. */
export function quarterBounds(period: string): { fromTs: string; toTs: string } {
  const { year, quarter } = mustParse(period);
  const firstMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
  return {
    fromTs: new Date(`${year}-${firstMonth}-01T00:00:00+07:00`).toISOString(),
    toTs: new Date(`${year}-${LAST_DAY[quarter]}T23:59:59+07:00`).toISOString(),
  };
}

/** Newest quarter whose last day plus `publishLagDays` is on or before `todayVn` ('YYYY-MM-DD'). */
export function latestExpectedPeriod(todayVn: string, publishLagDays: number): string {
  if (!isValidDate(todayVn)) throw new RangeError(`invalid date: ${todayVn}`);
  const today = Date.parse(`${todayVn}T00:00:00Z`);
  const year = Number(todayVn.slice(0, 4));
  const quarter = Math.floor((Number(todayVn.slice(5, 7)) - 1) / 3) + 1;
  let period = `${year}Q${quarter}`;
  for (let i = 0; i < 8; i++) {
    const { year: y, quarter: q } = mustParse(period);
    if (Date.parse(`${y}-${LAST_DAY[q]}T00:00:00Z`) + publishLagDays * DAY_MS <= today) return period;
    period = addQuarters(period, -1);
  }
  return period;
}

export interface OpenGap {
  id: number;
  fromTs: string;
  toTs: string;
}

export interface FinancialGapPlan {
  /** Periods to insert as new gaps. */
  toRecord: string[];
  /** Ids of open gaps whose period is now present. */
  toResolve: number[];
}

/**
 * Missing quarters between the symbol's first known period (or windowStart) and windowEnd.
 * A symbol with no known period expects nothing. Open gaps are matched by instant, not string.
 */
export function planFinancialGaps(input: {
  windowStart: string;
  windowEnd: string;
  knownPeriods: readonly string[];
  presentPeriods: readonly string[];
  openGaps: readonly OpenGap[];
}): FinancialGapPlan {
  const present = new Set(input.presentPeriods);
  const matches = (g: OpenGap, period: string) => {
    const b = quarterBounds(period);
    return Date.parse(g.fromTs) === Date.parse(b.fromTs) && Date.parse(g.toTs) === Date.parse(b.toTs);
  };
  const toResolve = input.openGaps.filter((g) => [...present].some((p) => matches(g, p))).map((g) => g.id);

  const toRecord: string[] = [];
  if (input.knownPeriods.length > 0) {
    const first = [...input.knownPeriods].sort(comparePeriods)[0] as string;
    let p = comparePeriods(first, input.windowStart) > 0 ? first : input.windowStart;
    while (comparePeriods(p, input.windowEnd) <= 0) {
      if (!present.has(p) && !input.openGaps.some((g) => matches(g, p))) toRecord.push(p);
      p = addQuarters(p, 1);
    }
  }
  return { toRecord, toResolve };
}
