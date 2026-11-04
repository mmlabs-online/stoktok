/** Daily price gap planning (R4): pure, instants compared as epoch ms, never as strings. */
import { tradingDaysBetween, vnDateOf, vnDayBoundsUtc } from '../calendar';
import type { OpenGap } from './quarters';

/** `data_gaps.data_type` of daily price gaps; shared by the worker and the web chart. */
export const PRICES_GAP_TYPE = 'prices_daily';

export interface PriceGapPlan {
  /** Trading days ('YYYY-MM-DD') to insert as new gaps. */
  toRecord: string[];
  /** Ids of open gaps whose days are all stored (or no longer expected). */
  toResolve: number[];
}

/** Why a data gap was resolved (`data_gaps.resolved_reason`). */
export type GapResolvedReason = 'data_stored' | 'non_trading_day';

function gapDays(g: OpenGap, holidays: readonly string[]): string[] {
  return tradingDaysBetween(vnDateOf(new Date(g.fromTs)), vnDateOf(new Date(g.toTs)), holidays);
}

/** The stored-date range to read: the window, extended to cover every open gap so old gaps can resolve. */
export function priceGapReadRange(input: {
  windowStart: string;
  windowEnd: string;
  openGaps: readonly OpenGap[];
}): { from: string; to: string } {
  let from = input.windowStart;
  let to = input.windowEnd;
  for (const g of input.openGaps) {
    const gf = vnDateOf(new Date(g.fromTs));
    const gt = vnDateOf(new Date(g.toTs));
    if (gf < from) from = gf;
    if (gt > to) to = gt;
  }
  return { from, to };
}

/**
 * Missing trading days between the symbol's first stored date (or windowStart) and windowEnd.
 * A symbol with no stored data expects nothing. `storedDates` must cover `priceGapReadRange`.
 */
export function planPriceGaps(input: {
  windowStart: string;
  windowEnd: string;
  firstStoredDate: string | null;
  storedDates: readonly string[];
  openGaps: readonly OpenGap[];
  holidays: readonly string[];
}): PriceGapPlan {
  const stored = new Set(input.storedDates);
  // `every` is vacuously true when a holiday was added later: the gap resolves as "no longer expected".
  const toResolve = input.openGaps.filter((g) => gapDays(g, input.holidays).every((d) => stored.has(d))).map((g) => g.id);
  const resolving = new Set(toResolve);
  const stillOpen = input.openGaps.filter((g) => !resolving.has(g.id));

  const toRecord: string[] = [];
  if (input.firstStoredDate !== null) {
    const start = input.firstStoredDate > input.windowStart ? input.firstStoredDate : input.windowStart;
    for (const day of tradingDaysBetween(start, input.windowEnd, input.holidays)) {
      if (stored.has(day)) continue;
      const b = vnDayBoundsUtc(day);
      const from = Date.parse(b.fromTs);
      const to = Date.parse(b.toTs);
      if (stillOpen.some((g) => Date.parse(g.fromTs) <= from && Date.parse(g.toTs) >= to)) continue;
      toRecord.push(day);
    }
  }
  return { toRecord, toResolve };
}

/**
 * Ids of open gaps whose days are all non-trading (holidays or weekends). Never looks at stored prices,
 * so a gap that covers any real trading day is never returned (R4).
 */
export function holidayOnlyGapIds(openGaps: readonly OpenGap[], holidays: readonly string[]): number[] {
  const ids = openGaps.filter((g) => gapDays(g, holidays).length === 0).map((g) => g.id);
  return [...new Set(ids)].sort((a, b) => a - b);
}
