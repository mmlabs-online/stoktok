import type { DailyBar } from '@stoktok/core';

export interface RejectedBar {
  tradeDate?: string;
  reason: string;
}

export interface FetchResult {
  bars: DailyBar[];
  rejected: RejectedBar[];
  /** Effective adjusted-history cut-off (own detection merged with ctx.rejectOnOrBefore); absent when none. */
  adjustedCutoff?: string;
}

/** Daily OHLCV for one symbol and an inclusive 'YYYY-MM-DD' range. Implementations return integer VND (R2). */
export interface PriceSource {
  /** Stored as `source` on every row (R4). */
  readonly name: string;
  /** `ctx.rejectOnOrBefore`: bars dated on or before it are rejected (cut-off found in a newer chunk). */
  fetchDaily(
    symbol: string,
    fromDate: string,
    toDate: string,
    ctx: { lastClose?: number; rejectOnOrBefore?: string },
  ): Promise<FetchResult>;
}

export { SourceError } from '@stoktok/sources';
