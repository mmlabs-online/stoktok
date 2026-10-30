import { tradingDaysBetween } from '../calendar';

/**
 * Splits the inclusive trading-day range [fromDate, toDate] into consecutive chunks of at most
 * `chunkTradingDays` trading days, newest first (a run cut short still keeps the latest history).
 * Chunk bounds are trading days. Empty range gives [].
 */
export function planBackfillChunks(
  fromDate: string,
  toDate: string,
  chunkTradingDays: number,
  holidays: readonly string[],
): { from: string; to: string }[] {
  if (!Number.isInteger(chunkTradingDays) || chunkTradingDays < 1) {
    throw new RangeError('chunkTradingDays must be a positive integer');
  }
  const days = tradingDaysBetween(fromDate, toDate, holidays);
  const out: { from: string; to: string }[] = [];
  for (let end = days.length; end > 0; end -= chunkTradingDays) {
    const start = Math.max(0, end - chunkTradingDays);
    out.push({ from: days[start] as string, to: days[end - 1] as string });
  }
  return out;
}
