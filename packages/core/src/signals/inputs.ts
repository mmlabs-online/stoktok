/** Freshness and gap checks shared by all medium-term rules, defined once (R4). Pure: no clock, no I/O. */
import { isTradingDay, subtractTradingDays, vnDateOf, vnDayBoundsUtc } from '../calendar';
import { addQuarters, comparePeriods, latestExpectedPeriod, quarterBounds } from '../market/quarters';
import type { StoredClose } from '../market/price-board';
import { PPM, mulDiv, roundDiv } from '../money';
import type { SignalRules } from './config';
import { DATA_REASONS, REASON_ORDER, RULE_VERSION, SIGNAL_HORIZON } from './types';
import type { EpsBasis, GapRef, ReasonCode, SignalLabel, SignalResult, SnapshotRef, StoredFinancials } from './types';

const DAY_MS = 86_400_000;
const MISSING_DATES_LIMIT = 20;

/** The data date of this run: the newest stored trade date, but never earlier than the expected one. */
export function resolveSignalDate(expectedDate: string, latestTradeDates: readonly string[]): string {
  let max = expectedDate;
  for (const d of latestTradeDates) if (d > max) max = d;
  return max;
}

/** First and last instant of the VN calendar days fromDate..toDate, as epoch ms. */
export function vnDayBounds(fromDate: string, toDate: string): { from: number; to: number } {
  return { from: Date.parse(vnDayBoundsUtc(fromDate).fromTs), to: Date.parse(vnDayBoundsUtc(toDate).toTs) };
}

export function gapOverlaps(gap: { fromTs: string; toTs: string }, bounds: { from: number; to: number }): boolean {
  return Date.parse(gap.fromTs) <= bounds.to && Date.parse(gap.toTs) >= bounds.from;
}

function relevantGaps(gaps: readonly GapRef[], symbol: string, bounds: { from: number; to: number }): GapRef[] {
  return gaps.filter((g) => (g.symbol === symbol || g.symbol === null) && gapOverlaps(g, bounds));
}

export function priceRef(c: StoredClose): SnapshotRef {
  return { ref: `prices_daily:${c.symbol}:${c.tradeDate}`, source: c.source, fetchedAt: c.fetchedAt };
}

export function financialsRef(r: StoredFinancials): SnapshotRef {
  return { ref: `financials:${r.symbol}:${r.period}`, source: r.source, fetchedAt: r.fetchedAt };
}

export function gapSnapshotRef(g: GapRef): SnapshotRef {
  return { ref: `data_gaps:${g.id}`, fromTs: g.fromTs, toTs: g.toTs };
}

/** Closes up to signalDate, oldest first. */
function closesUpTo(closes: readonly StoredClose[], signalDate: string): StoredClose[] {
  return closes.filter((c) => c.tradeDate <= signalDate).sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : 1));
}

export function checkLatestPrice(
  closes: readonly StoredClose[],
  signalDate: string,
): { reasons: ReasonCode[]; latest: StoredClose | null } {
  const sorted = closesUpTo(closes, signalDate);
  const latest = sorted[sorted.length - 1] ?? null;
  if (latest === null) return { reasons: ['price_missing'], latest };
  return { reasons: latest.tradeDate < signalDate ? ['price_stale'] : [], latest };
}

export interface PriceWindowCheck {
  reasons: ReasonCode[];
  /** The `days` closes of the window, oldest first; empty unless the window is complete. */
  window: StoredClose[];
  missingDates: string[];
  gaps: GapRef[];
}

/**
 * The last `days` trading days up to the newest stored bar must all be stored. Fewer than `days` stored bars
 * is insufficient_history; a hole inside the expected dates is price_gap. Staleness is checkLatestPrice's job.
 */
export function checkPriceWindow(input: {
  symbol: string;
  closes: readonly StoredClose[];
  days: number;
  signalDate: string;
  holidays: readonly string[];
  gaps: readonly GapRef[];
}): PriceWindowCheck {
  const { days, signalDate, holidays } = input;
  const sorted = closesUpTo(input.closes, signalDate);
  const reasons: ReasonCode[] = [];
  let window: StoredClose[] = [];
  let missingDates: string[] = [];
  const newest = sorted[sorted.length - 1];
  const endDate = newest?.tradeDate ?? signalDate;
  const fromDate = subtractTradingDays(endDate, days - 1, holidays);

  if (sorted.length < days) {
    reasons.push('insufficient_history');
  } else {
    const byDate = new Map(sorted.map((c) => [c.tradeDate, c]));
    const expected: string[] = [];
    for (let d = fromDate; d <= endDate; d = nextDay(d)) if (isTradingDay(d, holidays)) expected.push(d);
    missingDates = expected.filter((d) => !byDate.has(d));
    if (missingDates.length > 0) reasons.push('price_gap');
    else window = expected.map((d) => byDate.get(d) as StoredClose);
  }

  const gaps = relevantGaps(input.gaps, input.symbol, vnDayBounds(fromDate, signalDate));
  if (gaps.length > 0) reasons.push('price_gap_recorded');
  return { reasons, window, missingDates: missingDates.slice(0, MISSING_DATES_LIMIT), gaps };
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export type FinancialsRule = 'pe' | 'pb' | 'growth';

/** Quarters a rule needs, ending at the newest stored one. */
export function requiredQuarters(rule: FinancialsRule, basis: EpsBasis, rules: SignalRules): number {
  if (rule === 'pb') return 1;
  if (rule === 'pe') return basis === 'ttm' ? 1 : 4;
  return rules.earningsGrowth.comparisons + 4;
}

export interface FinancialsCheck {
  reasons: ReasonCode[];
  /** The required quarters ending at the newest stored one, oldest first; empty unless all are stored. */
  rows: StoredFinancials[];
  latestExpected: string;
  missingPeriods: string[];
  gaps: GapRef[];
}

export function checkFinancials(input: {
  symbol: string;
  rows: readonly StoredFinancials[];
  required: number;
  signalDate: string;
  publishLagDays: number;
  gaps: readonly GapRef[];
  maxFetchAgeDays: number;
}): FinancialsCheck {
  const { required, signalDate } = input;
  const latestExpected = latestExpectedPeriod(signalDate, input.publishLagDays);
  const mine = input.rows.filter((r) => r.symbol === input.symbol);
  const reasons: ReasonCode[] = [];
  const newest = mine.map((r) => r.period).sort(comparePeriods).pop();
  if (newest === undefined) {
    return { reasons: ['financials_missing'], rows: [], latestExpected, missingPeriods: [], gaps: [] };
  }
  if (comparePeriods(newest, latestExpected) < 0) reasons.push('financials_stale');

  const byPeriod = new Map(mine.map((r) => [r.period, r]));
  const periods: string[] = [];
  for (let i = required - 1; i >= 0; i--) periods.push(addQuarters(newest, -i));
  const missingPeriods = periods.filter((p) => !byPeriod.has(p));
  if (missingPeriods.length > 0) reasons.push('financials_gap');
  const rows = missingPeriods.length > 0 ? [] : periods.map((p) => byPeriod.get(p) as StoredFinancials);

  const last = comparePeriods(newest, latestExpected) > 0 ? newest : latestExpected;
  const bounds = {
    from: Date.parse(quarterBounds(periods[0] as string).fromTs),
    to: Date.parse(quarterBounds(last).toTs),
  };
  const gaps = relevantGaps(input.gaps, input.symbol, bounds);
  if (gaps.length > 0) reasons.push('financials_gap_recorded');

  const oldestFetch = new Date(Date.parse(`${signalDate}T00:00:00Z`) - input.maxFetchAgeDays * DAY_MS).toISOString().slice(0, 10);
  const used = periods.flatMap((p) => byPeriod.get(p) ?? []);
  if (used.some((r) => vnDateOf(new Date(r.fetchedAt)) < oldestFetch)) reasons.push('financials_fetch_stale');
  return { reasons, rows, latestExpected, missingPeriods, gaps };
}

/** The rows' EPS basis: the source's declared one if all rows agree, else unverified (docs/adr/0002). */
export function resolveEpsBasis(rows: readonly StoredFinancials[], basisBySource: Readonly<Record<string, EpsBasis>>): EpsBasis {
  const bases = new Set(rows.map((r) => basisBySource[r.source] ?? 'unverified'));
  const only = bases.size === 1 ? [...bases][0] : undefined;
  return only ?? 'unverified';
}

/** Trailing-12-month EPS from rows (oldest first): quarterly = sum of the last 4, ttm = latest, unverified = null. */
export function ttmEps(rows: readonly StoredFinancials[], basis: EpsBasis): number | null {
  if (basis === 'unverified') return null;
  if (basis === 'ttm') return rows[rows.length - 1]?.eps ?? null;
  if (rows.length < 4) return null;
  return rows.slice(-4).reduce((sum, r) => sum + r.eps, 0);
}

/** Median of integers; an even count averages the middle two, rounded half away from zero. null when empty. */
export function medianInt(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] as number;
  return Number(roundDiv(BigInt(s[mid - 1] as number) + BigInt(s[mid] as number), 2n));
}

/** round(a * 1,000,000 / b), or null when b <= 0 or the result is not a safe integer. */
export function safeRatioPpm(a: number, b: number): number | null {
  if (b <= 0) return null;
  try {
    return mulDiv(a, PPM, b);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Builds the result: any reason suppresses it (no label, no value); otherwise label and value are required. */
export function finalizeResult(input: {
  symbol: string;
  ruleId: string;
  signalDate: string;
  reasons: readonly ReasonCode[];
  label: SignalLabel | null;
  value: number | null;
  inputs: Record<string, unknown>;
}): SignalResult {
  const set = new Set(input.reasons);
  const reasons = REASON_ORDER.filter((r) => set.has(r));
  const base = {
    symbol: input.symbol,
    ruleId: input.ruleId,
    ruleVersion: RULE_VERSION,
    horizon: SIGNAL_HORIZON,
    signalDate: input.signalDate,
    inputs: input.inputs,
  };
  if (reasons.length > 0) {
    const dataFresh = !reasons.some((r) => (DATA_REASONS as readonly string[]).includes(r));
    return { ...base, status: 'suppressed', label: null, value: null, dataFresh, reasons };
  }
  if (input.label === null || input.value === null) throw new RangeError('an ok signal needs a label and a value');
  return { ...base, status: 'ok', label: input.label, value: input.value, dataFresh: true, reasons };
}
