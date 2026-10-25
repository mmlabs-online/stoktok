import { isTradingDay, previousTradingDay, vnDateOf, vnMinutesOf } from '../calendar';

export type PriceStatus = 'fresh' | 'stale' | 'missing';

/**
 * The trade date whose close should already be stored at `now` (R4): today (Vietnam) if it is a
 * trading day and the cutoff has passed, otherwise the previous trading day.
 */
export function expectedPriceDate(now: Date, holidays: readonly string[], cutoffMinutesVn: number): string {
  const today = vnDateOf(now);
  if (isTradingDay(today, holidays) && vnMinutesOf(now) >= cutoffMinutesVn) return today;
  return previousTradingDay(today, holidays);
}

export function priceStatus(quote: { tradeDate: string } | undefined, expectedDate: string): PriceStatus {
  if (!quote) return 'missing';
  return quote.tradeDate < expectedDate ? 'stale' : 'fresh';
}
