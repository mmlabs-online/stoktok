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
