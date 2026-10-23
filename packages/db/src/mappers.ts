/** Row <-> domain conversions for assets and watchlist. No financial calculation (R1); integers only (R2). */
import { RowMappingError, toSafeInt } from '@stoktok/core';
import type { AssetRow, WatchlistRow } from './rows';

export interface Asset {
  id: string;
  type: 'cash' | 'other';
  name: string;
  /** Integer VND. */
  value: number;
  /** 'YYYY-MM-DD'. */
  asOf: string;
}

export interface WatchlistEntry {
  symbol: string;
  group: string;
  addedAt: string;
}

// core does not export isValidDate; a local format check avoids a core change (STK-006 plan).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assetFromRow(row: AssetRow): Asset {
  const t = 'assets';
  if (row.type !== 'cash' && row.type !== 'other') throw new RowMappingError(t, 'type', `invalid type: ${row.type}`);
  if (typeof row.as_of !== 'string' || !DATE_RE.test(row.as_of)) {
    throw new RowMappingError(t, 'as_of', `invalid date: ${String(row.as_of)}`);
  }
  return { id: row.id, type: row.type, name: row.name, value: toSafeInt(row.value, 'value', t), asOf: row.as_of };
}

export function assetToRow(asset: Omit<Asset, 'id'>): Omit<AssetRow, 'id'> {
  return { type: asset.type, name: asset.name, value: asset.value, as_of: asset.asOf };
}

export function watchlistFromRow(row: WatchlistRow): WatchlistEntry {
  return { symbol: row.symbol, group: row.group_name, addedAt: row.added_at };
}
