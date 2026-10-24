import type { DailyBar } from '@stoktok/core';

export interface RejectedBar {
  tradeDate?: string;
  reason: string;
}

export interface FetchResult {
  bars: DailyBar[];
  rejected: RejectedBar[];
}

/** Daily OHLCV for one symbol and an inclusive 'YYYY-MM-DD' range. Implementations return integer VND (R2). */
export interface PriceSource {
  /** Stored as `source` on every row (R4). */
  readonly name: string;
  fetchDaily(symbol: string, fromDate: string, toDate: string, ctx: { lastClose?: number }): Promise<FetchResult>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
