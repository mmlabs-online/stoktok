export const ADJUSTED_HISTORY_REASON = 'adjusted_price_history';

const isFractional = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && !Number.isInteger(x);

/**
 * Latest trade date ('YYYY-MM-DD') of a bar with a fractional open/high/low/close, or null when there is none.
 * A source that sends adjusted prices does so for every session before the latest corporate action, so every
 * bar on or before this date is suspect, whole-number values included. A fractional bar without a date counts
 * as `unknownDateCutoff` (fail-safe). Non-number values are ignored: core's own invalid_* reasons handle them.
 */
export function adjustedHistoryCutoff(
  bars: readonly { tradeDate: string | undefined; open: unknown; high: unknown; low: unknown; close: unknown }[],
  unknownDateCutoff: string,
): string | null {
  let cutoff: string | null = null;
  for (const b of bars) {
    if (![b.open, b.high, b.low, b.close].some(isFractional)) continue;
    const d = b.tradeDate ?? unknownDateCutoff;
    if (cutoff === null || d > cutoff) cutoff = d;
  }
  return cutoff;
}
