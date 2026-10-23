import type { Int8 } from '@stoktok/core';

export interface AssetRow {
  id: string;
  type: string;
  name: string;
  value: Int8;
  as_of: string;
}

export interface WatchlistRow {
  symbol: string;
  group_name: string;
  added_at: string;
}

/** Selected columns only. */
export interface PriceDailyRow {
  symbol: string;
  trade_date: string;
  close: number;
  source: string;
  fetched_at: string;
}
