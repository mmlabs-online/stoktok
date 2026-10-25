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

export interface SymbolRow {
  symbol: string;
  exchange: string | null;
}

/** Selected columns only: a daily close with its volume. */
export interface PriceCloseRow extends PriceDailyRow {
  volume: Int8;
}

/** Upsert payload (all columns; R4 source + fetched_at). */
export interface PriceDailyInsert {
  symbol: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  foreign_net: number | null;
  source: string;
  fetched_at: string;
}
